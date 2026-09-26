// CLI over src/core: a 1-of-1 Safe whose owner signs off-box.
// CHAIN=mainnet|arbitrum|optimism|base|polygon (default arbitrum)
// TOKEN=usdt|usdc: transfer that token, gas paid in it via the paymaster; TOKEN=eth: transfer ETH, the Safe pays gas in ETH
//   tsx scripts/safe.ts addr                     address, deployed?, balance
//   tsx scripts/safe.ts prepare <to> <amount>    build the UserOp, write op.json + typed.json
//   sign typed.json: browser-web3-signer evm sign-typed-data --file typed.json --address <owner> --chain <id>
//                    or cast wallet sign --data --from-file typed.json <--ledger|--trezor|--account ..>
//   tsx scripts/safe.ts submit <signature>       verify signer, send, wait for inclusion
import { readFileSync, writeFileSync } from "node:fs"
import { encodeFunctionData, erc20Abi, formatUnits, parseEther, parseUnits, type Address, type Hex } from "viem"
import { CHAINS, type ChainKey } from "../src/core/chains"
import { clients, opFromJson, prepareOp, safeAccount, submitOp, toJson, typedDataFromJson, type Call, type Gas, type SafeRef } from "../src/core/userop"

const chainKey = (process.env.CHAIN ?? "arbitrum") as ChainKey
if (!CHAINS[chainKey]) throw new Error(`CHAIN must be one of ${Object.keys(CHAINS).join("|")}`)
const asset = process.env.TOKEN ?? "usdt"
if (!["usdt", "usdc", "eth"].includes(asset)) throw new Error("TOKEN must be usdt, usdc or eth")
const ref: SafeRef = { chainKey, owner: (process.env.OWNER ?? "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266") as Address, saltNonce: BigInt(process.env.SALT ?? 0), rpcUrl: process.env.RPC }
const token = asset === "eth" ? null : CHAINS[chainKey][asset as "usdt" | "usdc"]
const { chain, publicClient } = clients(ref)

async function balance(addr: Address, blockNumber?: bigint) {
    if (!token) return formatUnits(await publicClient.getBalance({ address: addr, blockNumber }), 18)
    const [raw, decimals] = await Promise.all([
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [addr], blockNumber }),
        publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    ])
    return formatUnits(raw, decimals)
}

/** Load-balanced public RPCs may not have `blockNumber` yet on the node that answers; retry until one does. */
async function atBlock<T>(fn: () => Promise<T>): Promise<T> {
    for (let i = 0; ; i++) {
        try { return await fn() } catch (e) {
            if (i >= 20 || !/block not found|header not found|unknown block/i.test(String((e as Error).message))) throw e
            await new Promise(r => setTimeout(r, 500))
        }
    }
}

async function addr(blockNumber?: bigint) {
    if (blockNumber) return atBlock(() => show(blockNumber))
    return show()
}

async function show(blockNumber?: bigint) {
    const { address } = await safeAccount(ref)
    const code = await publicClient.getCode({ address, blockNumber })
    console.log({ chain: chain.name, owner: ref.owner, safe: address, deployed: !!code && code !== "0x", [asset]: await balance(address, blockNumber), ...(blockNumber ? { atBlock: blockNumber } : {}) })
}

async function prepare(to: Address, amount: string) {
    let calls: Call[], gas: Gas
    if (!token) {
        calls = [{ to, value: parseEther(amount) }]
        gas = { kind: "native" }
    } else {
        const decimals = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })
        calls = [{ to: token, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, parseUnits(amount, decimals)] }) }]
        gas = { kind: "token", token }
    }
    const { op, typedData } = await prepareOp(ref, calls, gas)
    writeFileSync("op.json", toJson(op))
    writeFileSync("typed.json", toJson(typedData))
    console.log(toJson({ chain: chain.name, safe: op.sender, deploys: !!op.factory, gas: gas.kind === "native" ? "ETH from the Safe" : `${asset} via paymaster`, to, amount, maxFeePerGas: op.maxFeePerGas }))
    console.log(`\nsign typed.json with the owner (chain ${chain.id}), then: tsx scripts/safe.ts submit <signature>`)
}

async function submit(signature: Hex) {
    const r = await submitOp(ref, opFromJson(readFileSync("op.json", "utf8")), typedDataFromJson(readFileSync("typed.json", "utf8")), signature)
    console.log({ success: r.success, tx: r.explorer, gasCostNative: formatUnits(r.actualGasCost, 18) })
    await addr(r.blockNumber)
}

const [cmd, ...args] = process.argv.slice(2)
const run = { addr: () => addr(), prepare: () => prepare(args[0] as Address, args[1]), submit: () => submit(args[0] as Hex) }[cmd!]
if (!run) { console.error("usage: tsx scripts/safe.ts addr | prepare <to> <amount> | submit <signature>"); process.exit(1) }
await run()
