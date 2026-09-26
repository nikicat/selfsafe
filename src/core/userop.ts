// UserOperations for a 1-of-1 Safe (4337 module) whose owner signs elsewhere (browser wallet, hardware, CLI).
// Flow: prepareOp -> owner signs `typedData` -> submitOp. Browser-safe: no Node APIs.
import {
    createPublicClient, getTypesForEIP712Domain, http, recoverTypedDataAddress, isAddressEqual,
    type Address, type Hex, type PublicClient, type TypedDataDefinition, type TypedDataDomain, type TypedDataParameter,
} from "viem"
import { toAccount } from "viem/accounts"
import { entryPoint07Address, type UserOperation } from "viem/account-abstraction"
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
    rpcUrl?: string // unset: the chain's default public RPC
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
    const { chain } = CHAINS[ref.chainKey]
    const publicClient = createPublicClient({ chain, transport: http(ref.rpcUrl) }) as PublicClient
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
    const op = await client.prepareUserOperation({ calls }) as UserOperation<"0.7">
    try {
        await account.signUserOperation(op)
    } catch (e) {
        if (!(e instanceof Captured)) throw e
        const { domain, types, primaryType, message } = e.typed
        return { op, typedData: { domain: domain ?? {}, primaryType, message: message as Record<string, unknown>, types: { EIP712Domain: getTypesForEIP712Domain({ domain }), ...types } as unknown as SignRequest["types"] } }
    }
    throw new Error("the owner signer was not invoked")
}

/** Check the owner's signature over `typedData`, send `op` unchanged, wait for inclusion. */
export async function submitOp(ref: SafeRef, op: UserOperation<"0.7">, typedData: SignRequest, signature: Hex) {
    const { EIP712Domain: _, ...types } = typedData.types
    const signer = await recoverTypedDataAddress({ ...typedData, types, signature } as unknown as TypedDataDefinition & { signature: Hex })
    if (!isAddressEqual(signer, ref.owner)) throw new Error(`signature is from ${signer}, expected the owner ${ref.owner}`)
    const { chain, publicClient, bundler } = clients(ref)
    if (Number(typedData.domain?.chainId) !== chain.id) throw new Error(`typed data is for chain ${typedData.domain?.chainId}, not ${chain.id}`)

    const safeSig = await (await safeAccount(ref, signature)).signUserOperation(op)
    // No `account`: viem sends the op as-is. Re-preparing would refetch paymaster data and void the signature.
    const userOpHash = await bundler.sendUserOperation({ ...op, signature: safeSig, entryPointAddress: entryPoint07Address })
    const r = await bundler.waitForUserOperationReceipt({ hash: userOpHash, timeout: 120_000 })
    // Read state after this op at `blockNumber`: load-balanced public RPCs can answer "latest" from a node behind the bundler's.
    return { userOpHash, txHash: r.receipt.transactionHash, blockNumber: r.receipt.blockNumber, success: r.success, actualGasCost: r.actualGasCost, explorer: `${chain.blockExplorers?.default.url}/tx/${r.receipt.transactionHash}` }
}

/** JSON with bigints as decimal strings, for handing ops and typed data across processes or storage. */
export const toJson = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)
const BIGINT_FIELDS = new Set(["nonce", "callGasLimit", "verificationGasLimit", "preVerificationGas", "maxFeePerGas", "maxPriorityFeePerGas", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"])
export const opFromJson = (text: string) => Object.fromEntries(Object.entries(JSON.parse(text)).map(([k, v]) => [k, BIGINT_FIELDS.has(k) && v != null ? BigInt(v as string) : v])) as UserOperation<"0.7">
export const typedDataFromJson = (text: string) => {
    const t = JSON.parse(text)
    t.message = Object.fromEntries(Object.entries(t.message).map(([k, v]) => [k, typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : v]))
    return t as SignRequest
}
