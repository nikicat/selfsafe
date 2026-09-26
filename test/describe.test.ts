import { test } from "node:test"
import assert from "node:assert/strict"
import { describeTypedData } from "../src/app/describe"

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
