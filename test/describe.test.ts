import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describeLifiCall, describeTypedData } from "../src/app/describe"

const SAFE = "0x124Ef647181eda69861b61596802129E3B018765"
const SPENDER = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD"
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3"
const now = 1_790_000_000
const ctx = { chainId: 8453, safe: SAFE, now, token: async () => ({ symbol: "USDC", decimals: 6 }) } as const
const permit2Domain = { name: "Permit2", chainId: 8453, verifyingContract: PERMIT2 }

test("Permit2 allowance: unlimited and never-expiring are both flagged", async () => {
    const d = await describeTypedData({
        domain: permit2Domain, primaryType: "PermitSingle", types: {},
        message: { details: { token: USDC, amount: (2n ** 160n - 1n).toString(), expiration: (2n ** 48n - 1n).toString(), nonce: "0" }, spender: SPENDER, sigDeadline: String(now + 1800) },
    }, ctx)
    assert.match(d.summary[0]!, /Permit2 allowance: 0x3fC9.* may spend up to UNLIMITED USDC of the Safe's, with no expiry/)
    assert.deepEqual(d.warnings, [`UNLIMITED USDC for ${SPENDER}`, "the allowance never expires"])
})

test("Permit2 transfer with a witness: bounded and short-lived, no warnings", async () => {
    const d = await describeTypedData({
        domain: permit2Domain, primaryType: "PermitWitnessTransferFrom", types: { PermitWitnessTransferFrom: [], TokenPermissions: [], ExclusiveDutchOrder: [], OrderInfo: [] },
        message: { permitted: { token: USDC, amount: "2500000" }, spender: SPENDER, nonce: "1", deadline: String(now + 600), witness: {} },
    }, ctx)
    assert.match(d.summary[0]!, /Permit2 transfer: .* may take 2\.5 USDC from the Safe once, until 2026-/)
    assert.match(d.summary[1]!, /conditions the spender enforces \(ExclusiveDutchOrder, OrderInfo\)/)
    assert.deepEqual(d.warnings, [])
})

test("EIP-2612 permit: long validity, foreign owner and chain mismatch are flagged", async () => {
    const d = await describeTypedData({
        domain: { name: "USD Coin", version: "2", chainId: 1, verifyingContract: USDC }, primaryType: "Permit", types: {},
        message: { owner: SPENDER, spender: SPENDER, value: "1000000", nonce: "0", deadline: String(now + 90 * 86400) },
    }, ctx)
    assert.match(d.summary[0]!, /Token permit: .* may spend 1 USDC of the Safe's, until/)
    assert.deepEqual(d.warnings, [
        "this signature is for chain 1, but the request came on chain 8453",
        "the permit stays valid for 90 days",
        `the permit is for owner ${SPENDER}, not this Safe`,
    ])
})

test("DAI-style permit and unknown typed data", async () => {
    const dai = await describeTypedData({
        domain: { name: "Dai Stablecoin", chainId: 8453, verifyingContract: USDC }, primaryType: "Permit", types: {},
        message: { holder: SAFE, spender: SPENDER, nonce: 0, expiry: 0, allowed: true },
    }, ctx)
    assert.deepEqual(dai.warnings, [`UNLIMITED USDC for ${SPENDER}`, "the permit never expires"])

    const login = await describeTypedData({ domain: { name: "Example", chainId: 8453 }, primaryType: "Login", types: {}, message: { nonce: "x" } }, ctx)
    assert.deepEqual(login, { summary: ["Login for Example: not a known format; read the data below"], warnings: [] })
})

// Real LI.FI Diamond calls from Base, with what LiFiTransferStarted / LiFiGenericSwapCompleted reported for them
const lifi: { kind: string; selector: string; input: `0x${string}`; value: string; event: { receiver: string } }[] =
    JSON.parse(readFileSync(new URL("fixtures/lifi-base.json", import.meta.url), "utf8"))
const call = (selector: string) => lifi.find(c => c.selector === selector)!
const lifiCtx = (safe: string) => ({ ...ctx, safe, nativeSymbol: "ETH", chainName: (id: number) => ({ 1: "Ethereum", 42161: "Arbitrum One" } as Record<number, string>)[id] }) as any
const describe = (selector: string, safe = SAFE) => describeLifiCall(call(selector).input, BigInt(call(selector).value), lifiCtx(safe))

test("LI.FI bridge: receiver and destination decoded; no warning when the receiver is the Safe itself", async () => {
    const relay = call("0xa3443faa")
    assert.deepEqual(await describe("0xa3443faa", relay.event.receiver), {
        summary: [`LI.FI bridge via relaydepository: sends 0.006622190190882415 ETH to ${relay.event.receiver} on Ethereum`], warnings: [] })
    const stargate = await describe("0xa6010a66")
    assert.match(stargate.summary[0]!, /via stargateV2: sends .* on Arbitrum One$/)
    assert.deepEqual(stargate.warnings, [`the receiver is ${call("0xa6010a66").event.receiver}, not this Safe`])
})

test("LI.FI bridge: non-EVM receivers, unmanaged chains and destination calls are flagged", async () => {
    assert.deepEqual((await describe("0x80c65808")).warnings, ["the receiver on Solana is not an EVM address and is not decoded here; check it in the dapp"])
    const across = call("0xa1f1ce43")
    assert.deepEqual((await describe("0xa1f1ce43", across.event.receiver)).warnings, [
        "the destination (chain 4663) is not a chain SelfSafe manages: the Safe may not be usable there",
        "the bridged funds are passed to a contract call on the destination chain; the final receiver is decided there",
    ])
})

test("LI.FI same-chain swap: receiver decoded; undecodable calls say so", async () => {
    const swap = await describe("0x736eac0b")
    assert.match(swap.summary[0]!, /^LI\.FI swap on this chain \(via jumper\.exchange\): the output goes to 0x51E4/)
    assert.deepEqual(swap.warnings, [`the receiver is ${call("0x736eac0b").event.receiver}, not this Safe`])
    const garbage = await describeLifiCall("0x12345678", 0n, lifiCtx(SAFE))
    assert.deepEqual(garbage.warnings, ["a LI.FI call (0x12345678) that could not be decoded: the receiver is unknown"])
})
