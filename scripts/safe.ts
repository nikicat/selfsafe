// 1-of-1 Safe (4337 module) whose owner signs off-box; gas paid in a stablecoin via Pimlico's ERC-20 paymaster.
// CHAIN=mainnet|arbitrum|optimism|base|polygon (default arbitrum); TOKEN=usdt|usdc (default usdt) is both gas and transferred token.
//   tsx safe.ts addr                     counterfactual address, deployed?, token balance
//   tsx safe.ts prepare <to> <amount>    build UserOp (token transfer), write op.json + typed.json
//   cast wallet sign --data --from-file typed.json <--ledger|--trezor|--account ..>
//   tsx safe.ts submit <signature>       verify signer, send, wait for receipt
import { readFileSync, writeFileSync } from "node:fs"
import {
    createPublicClient, encodeFunctionData, erc20Abi, formatUnits, getTypesForEIP712Domain, http,
    parseUnits, recoverTypedDataAddress, type Address, type Hex, type TypedDataDefinition,
} from "viem"
import { toAccount } from "viem/accounts"
import { entryPoint07Address } from "viem/account-abstraction"
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains"
import { createSmartAccountClient } from "permissionless"
import { toSafeSmartAccount } from "permissionless/accounts"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import { prepareUserOperationForErc20Paymaster } from "permissionless/experimental/pimlico"

const OWNER = (process.env.OWNER ?? "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266") as Address
const SALT = BigInt(process.env.SALT ?? 0)
// Tokens Pimlico's ERC-20 paymaster quotes (checked via pimlico_getTokenQuotes). Base USDT is bridged.
const CHAINS = {
    mainnet: { chain: mainnet, usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    arbitrum: { chain: arbitrum, usdt: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
    optimism: { chain: optimism, usdt: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
    base: { chain: base, usdt: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    polygon: { chain: polygon, usdt: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
} as const
const cfg = CHAINS[(process.env.CHAIN ?? "arbitrum") as keyof typeof CHAINS]
if (!cfg) throw new Error(`CHAIN must be one of ${Object.keys(CHAINS).join("|")}`)
const tokenName = process.env.TOKEN ?? "usdt"
if (tokenName !== "usdt" && tokenName !== "usdc") throw new Error("TOKEN must be usdt or usdc")
const { chain } = cfg
const TOKEN: Address = cfg[tokenName]
const BUNDLER = `https://public.pimlico.io/v2/${chain.id}/rpc`

const publicClient = createPublicClient({ chain, transport: http(process.env.RPC) }) // RPC unset => chain's default public RPC
const pimlico = createPimlicoClient({ chain, transport: http(BUNDLER), entryPoint: { address: entryPoint07Address, version: "0.7" } })

// Owner lives elsewhere: signTypedData either captures the request (prepare) or replays a supplied signature (submit).
class Captured extends Error { constructor(readonly typed: TypedDataDefinition) { super("captured") } }
const owner = (signature?: Hex) => toAccount({
    address: OWNER,
    async signTypedData(typed) {
        if (!signature) throw new Captured(typed as TypedDataDefinition)
        return signature
    },
    async signMessage() { throw new Error("owner signs typed data only") },
    async signTransaction() { throw new Error("owner signs typed data only") },
})

const safe = (signature?: Hex) => toSafeSmartAccount({
    client: publicClient, owners: [owner(signature)], version: "1.4.1",
    entryPoint: { address: entryPoint07Address, version: "0.7" }, saltNonce: SALT,
})

const client = async (signature?: Hex) => createSmartAccountClient({
    account: await safe(signature), chain, bundlerTransport: http(BUNDLER),
    paymaster: pimlico, paymasterContext: { token: TOKEN },
    userOperation: {
        estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast,
        prepareUserOperation: prepareUserOperationForErc20Paymaster(pimlico, { balanceOverride: true }), // estimate even before funding
    },
})

const balance = (addr: Address) => publicClient.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [addr] })
const decimals = () => publicClient.readContract({ address: TOKEN, abi: erc20Abi, functionName: "decimals" })
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2)
const withBigints = (o: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : v]))

async function addr() {
    const { address } = await safe()
    const code = await publicClient.getCode({ address })
    console.log({ chain: chain.name, owner: OWNER, safe: address, deployed: !!code && code !== "0x", [tokenName]: formatUnits(await balance(address), await decimals()) })
}

async function prepare(to: Address, amount: string) {
    const c = await client()
    const op = await c.prepareUserOperation({
        calls: [{ to: TOKEN, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, parseUnits(amount, await decimals())] }) }],
    })
    try {
        await c.account.signUserOperation(op)
        throw new Error("owner signer was not invoked")
    } catch (e) {
        if (!(e instanceof Captured)) throw e
        const { domain, types, primaryType, message } = e.typed
        writeFileSync("op.json", json(op))
        writeFileSync("typed.json", json({ types: { EIP712Domain: getTypesForEIP712Domain({ domain }), ...types }, primaryType, domain, message }))
    }
    console.log(json({ safe: op.sender, deploys: !!op.factory, chain: chain.name, calls: `approve(paymaster) + ${tokenName}.transfer`, to, amount, maxFeePerGas: op.maxFeePerGas }))
    console.log("\nsign:   cast wallet sign --data --from-file typed.json <signer flags>\nsubmit: tsx safe.ts submit <signature>")
}

async function submit(signature: Hex) {
    const { types, primaryType, domain, message } = JSON.parse(readFileSync("typed.json", "utf8"))
    if (Number(domain.chainId) !== chain.id) throw new Error(`typed.json is for chain ${domain.chainId}, CHAIN is ${chain.id}`)
    delete types.EIP712Domain
    const signer = await recoverTypedDataAddress({ types, primaryType, domain, message: withBigints(message), signature })
    if (signer.toLowerCase() !== OWNER.toLowerCase()) throw new Error(`signature is from ${signer}, expected owner ${OWNER}`)

    const op = withBigints(JSON.parse(readFileSync("op.json", "utf8"))) as any
    const safeSig = await (await safe(signature)).signUserOperation(op)
    // no `account` => viem sends the op as-is; re-preparing would refetch paymaster data and void the signature
    const hash = await pimlico.sendUserOperation({ ...op, signature: safeSig, entryPointAddress: entryPoint07Address })
    console.log("userOpHash", hash)
    const r = await pimlico.waitForUserOperationReceipt({ hash, timeout: 120_000 })
    console.log({ success: r.success, tx: `${chain.blockExplorers?.default.url}/tx/${r.receipt.transactionHash}`, gasCostNative: formatUnits(r.actualGasCost, 18) })
    await publicClient.waitForTransactionReceipt({ hash: r.receipt.transactionHash }) // public RPC may lag the bundler's node
    await addr()
}

const [cmd, ...args] = process.argv.slice(2)
const run = { addr, prepare: () => prepare(args[0] as Address, args[1]), submit: () => submit(args[0] as Hex) }[cmd!]
if (!run) { console.error("usage: tsx safe.ts addr | prepare <to> <amount> | submit <signature>"); process.exit(1) }
await run()
