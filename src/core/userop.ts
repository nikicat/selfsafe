// UserOperations for a 1-of-1 Safe (4337 module) whose owner signs elsewhere (browser wallet, hardware, CLI).
// Flow: prepareOp -> owner signs `typedData` -> submitOp. Browser-safe: no Node APIs.
import {
    BaseError, createPublicClient, erc20Abi, formatEther, formatUnits, getTypesForEIP712Domain, http, HttpRequestError, recoverTypedDataAddress, isAddressEqual,
    type Address, type Hex, type PublicClient, type TypedDataDefinition, type TypedDataDomain, type TypedDataParameter,
} from "viem"
import { toAccount } from "viem/accounts"
import { entryPoint07Address, getUserOperationHash, UserOperationReceiptNotFoundError, type UserOperation } from "viem/account-abstraction"
import { createSmartAccountClient } from "permissionless"
import { toSafeSmartAccount } from "permissionless/accounts"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import { prepareUserOperationForErc20Paymaster } from "permissionless/experimental/pimlico"
import { bundlerUrl, CHAINS, type ChainKey } from "./chains"

const ENTRY_POINT = { address: entryPoint07Address, version: "0.7" } as const

export interface SafeRef {
    chainKey: ChainKey
    owner: Address
    saltNonce?: bigint
    rpcUrl?: string // unset: CHAINS[chainKey].rpc
}

/** Who pays the bundler: the paymaster, repaid by the Safe in `token`; or the Safe itself in ETH. */
export type Gas = { kind: "token"; token: Address } | { kind: "native" }

export interface Call { to: Address; value?: bigint; data?: Hex }

/** EIP-712 data with the EIP712Domain type included, as wallets and `cast wallet sign --data` expect it. */
export interface SignRequest {
    domain: TypedDataDomain
    primaryType: string
    types: Record<string, readonly TypedDataParameter[]>
    message: Record<string, unknown>
}

export function clients(ref: SafeRef) {
    const { chain, rpc } = CHAINS[ref.chainKey]
    // batch: bursts of reads (balances, nonce, allowance) become one HTTP request, staying under public rate limits
    const publicClient = createPublicClient({ chain, transport: http(ref.rpcUrl ?? rpc, { batch: true }) }) as PublicClient
    const bundler = createPimlicoClient({ chain, transport: http(bundlerUrl(chain)), entryPoint: ENTRY_POINT })
    return { chain, publicClient, bundler }
}

// The owner's key is never here. Its signTypedData either captures the request (prepare) or replays a signature (submit).
class Captured extends Error { constructor(readonly typed: TypedDataDefinition) { super("captured") } }
const remoteOwner = (address: Address, signature?: Hex) => toAccount({
    address,
    async signTypedData(typed) {
        if (!signature) throw new Captured(typed as TypedDataDefinition)
        return signature
    },
    async signMessage() { throw new Error("the Safe owner signs typed data only") },
    async signTransaction() { throw new Error("the Safe owner signs typed data only") },
})

export function safeAccount(ref: SafeRef, signature?: Hex) {
    return toSafeSmartAccount({
        client: clients(ref).publicClient, owners: [remoteOwner(ref.owner, signature)], version: "1.4.1",
        entryPoint: ENTRY_POINT, saltNonce: ref.saltNonce ?? 0n,
    })
}

/** Build and price a UserOperation for `calls`; returns it with the typed data the owner must sign. */
export async function prepareOp(ref: SafeRef, calls: Call[], gas: Gas): Promise<{ op: UserOperation<"0.7">; typedData: SignRequest }> {
    const { chain, bundler } = clients(ref)
    const account = await safeAccount(ref)
    const client = createSmartAccountClient({
        account, chain, bundlerTransport: http(bundlerUrl(chain)),
        ...(gas.kind === "token" ? { paymaster: bundler, paymasterContext: { token: gas.token } } : {}),
        userOperation: {
            estimateFeesPerGas: async () => (await bundler.getUserOperationGasPrice()).fast,
            // Token mode injects approve(paymaster, maxFee) (plus approve(0) for mainnet USDT). The balance
            // override lets estimation run before the Safe is funded; the paymaster's final check uses real state.
            ...(gas.kind === "token" ? { prepareUserOperation: prepareUserOperationForErc20Paymaster(bundler, { balanceOverride: true }) } : {}),
        },
    })
    const op = await client.prepareUserOperation({ calls }).catch(async e => { throw await explainGasError(ref, gas, account.address, e) }) as UserOperation<"0.7">
    try {
        await account.signUserOperation(op)
    } catch (e) {
        if (!(e instanceof Captured)) throw e
        const { domain, types, primaryType, message } = e.typed
        return { op, typedData: { domain: domain ?? {}, primaryType, message: message as Record<string, unknown>, types: { EIP712Domain: getTypesForEIP712Domain({ domain }), ...types } as unknown as SignRequest["types"] } }
    }
    throw new Error("the owner signer was not invoked")
}

/**
 * The bundler and paymaster simulate on live state and report a Safe that cannot pay as bare EntryPoint codes:
 * AA50 (the paymaster's postOp could not collect the token) or AA21 (no ETH for the prefund). Say what the Safe holds.
 */
async function explainGasError(ref: SafeRef, gas: Gas, safe: Address, e: unknown): Promise<unknown> {
    const code = (e as Error)?.message?.match(/\bAA(50|21)\b/)?.[0]
    if (!code || (code === "AA50") !== (gas.kind === "token")) return e
    const { publicClient } = clients(ref)
    try {
        const held = gas.kind === "token"
            ? await Promise.all([
                publicClient.readContract({ address: gas.token, abi: erc20Abi, functionName: "balanceOf", args: [safe] }),
                publicClient.readContract({ address: gas.token, abi: erc20Abi, functionName: "decimals" }),
                publicClient.readContract({ address: gas.token, abi: erc20Abi, functionName: "symbol" }),
            ]).then(([b, d, s]) => `${formatUnits(b, d)} ${s}`)
            : `${formatEther(await publicClient.getBalance({ address: safe }))} ETH`
        return new Error(`the Safe cannot pay for gas: it holds ${held} on ${CHAINS[ref.chainKey].chain.name} (${code}). Fund it or pick another gas option.`)
    } catch { return e }
}

/**
 * Poll for the receipt, tolerating transient failures. Public bundler endpoints rate-limit, and a rate-limited
 * response without CORS headers reaches a browser as a bare network error; one such poll must not lose an op
 * that is already on its way.
 */
async function waitForReceipt(bundler: ReturnType<typeof clients>["bundler"], hash: Hex, timeoutMs = 180_000) {
    const end = Date.now() + timeoutMs
    let lastError: unknown
    while (Date.now() < end) {
        try { return await bundler.getUserOperationReceipt({ hash }) }
        catch (e) { if (!(e instanceof UserOperationReceiptNotFoundError)) lastError = e }
        await new Promise(r => setTimeout(r, 2000))
    }
    throw new Error(`no receipt for UserOperation ${hash} after ${timeoutMs / 1000}s${lastError ? ` (last error: ${(lastError as Error).message})` : ""}`)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** A failure worth retrying: no HTTP status (network error, or a rate-limited reply without CORS headers in a browser), 429 or 5xx. */
const isTransient = (e: unknown) => e instanceof BaseError && !!e.walk(x => x instanceof HttpRequestError && (!x.status || x.status === 429 || x.status >= 500))

/**
 * Send a signed op, retrying transient failures for about a minute (Pimlico's public endpoint rate-limits per IP for
 * ~30 s). A failed send may still have reached the bundler, so before each resend ask it whether it has the op.
 * Returns what `send` returned, or undefined when the bundler turned out to have the op already.
 */
export async function sendWithRetry<T>(send: () => Promise<T>, isKnown: () => Promise<boolean>, delaysMs = [2000, 4000, 8000, 16000, 30000]): Promise<T | undefined> {
    for (let i = 0; ; i++) {
        try { return await send() } catch (e) {
            if (!isTransient(e) || i >= delaysMs.length) throw e
            await sleep(delaysMs[i]!)
            if (await isKnown()) return undefined // sent despite the error; the caller knows the hash
        }
    }
}

/** Check the owner's signature over `typedData`, send `op` unchanged, wait for inclusion. `onSent` gets the UserOperation hash as soon as the bundler accepts it. */
export async function submitOp(ref: SafeRef, op: UserOperation<"0.7">, typedData: SignRequest, signature: Hex, onSent?: (userOpHash: Hex) => void) {
    const { EIP712Domain: _, ...types } = typedData.types
    const signer = await recoverTypedDataAddress({ ...typedData, types, signature } as unknown as TypedDataDefinition & { signature: Hex })
    if (!isAddressEqual(signer, ref.owner)) throw new Error(`signature is from ${signer}, expected the owner ${ref.owner}`)
    const { chain, publicClient, bundler } = clients(ref)
    if (Number(typedData.domain?.chainId) !== chain.id) throw new Error(`typed data is for chain ${typedData.domain?.chainId}, not ${chain.id}`)

    const safeSig = await (await safeAccount(ref, signature)).signUserOperation(op)
    // No `account`: viem sends the op as-is. Re-preparing would refetch paymaster data and void the signature.
    const signed = { ...op, signature: safeSig }
    const computedHash = getUserOperationHash({ userOperation: signed, entryPointAddress: entryPoint07Address, entryPointVersion: "0.7", chainId: chain.id })
    const userOpHash = await sendWithRetry(
        () => bundler.sendUserOperation({ ...signed, entryPointAddress: entryPoint07Address }),
        () => bundler.getUserOperation({ hash: computedHash }).then(() => true, () => false)) ?? computedHash
    onSent?.(userOpHash)
    const r = await waitForReceipt(bundler, userOpHash)
    // Read state after this op at `blockNumber`: load-balanced public RPCs can answer "latest" from a node behind the bundler's.
    return { userOpHash, txHash: r.receipt.transactionHash, blockNumber: r.receipt.blockNumber, success: r.success, actualGasCost: r.actualGasCost, explorer: `${chain.blockExplorers?.default.url}/tx/${r.receipt.transactionHash}` }
}

/** ERC-1271 on the Safe: the owner signs this SafeMessage over `hash`; the Safe (via the 4337 module as fallback handler) checks it in isValidSignature. */
export const safeMessage = (chainId: number, safe: Address, hash: Hex): SignRequest => ({
    domain: { chainId, verifyingContract: safe }, primaryType: "SafeMessage",
    types: { EIP712Domain: [{ name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], SafeMessage: [{ name: "message", type: "bytes" }] },
    message: { message: hash },
})
export const ERC1271_MAGIC = "0x1626ba7e"
export const erc1271Abi = [{ type: "function", name: "isValidSignature", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "bytes" }], outputs: [{ type: "bytes4" }] }] as const

/** JSON with bigints as decimal strings, for handing ops and typed data across processes or storage. */
export const toJson = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)
const BIGINT_FIELDS = new Set(["nonce", "callGasLimit", "verificationGasLimit", "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"])
export const opFromJson = (text: string) => Object.fromEntries(Object.entries(JSON.parse(text)).map(([k, v]) => [k, BIGINT_FIELDS.has(k) && v != null ? BigInt(v as string) : v])) as UserOperation<"0.7">
export const typedDataFromJson = (text: string) => {
    const t = JSON.parse(text)
    t.message = Object.fromEntries(Object.entries(t.message).map(([k, v]) => [k, typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : v]))
    return t as SignRequest
}
