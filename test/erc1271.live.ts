// ERC-1271 with a real owner signature, against Base mainnet state: eth_simulateV1 deploys a fresh owner's Safe
// through the real factory and setup (4337 module as fallback handler), then calls isValidSignature in the same
// simulated block. Nothing is sent. Needs network. Run: tsx --test test/erc1271.live.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { hashMessage, hashTypedData, type Hex, type TypedDataDefinition } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { simulateCalls } from "viem/actions"
import { clients, erc1271Abi, ERC1271_MAGIC, safeAccount, safeMessage, type SafeRef } from "../src/core/userop"

const owner = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())
const ref: SafeRef = { chainKey: "base", owner: owner.address }
const { chain, publicClient } = clients(ref)

/** isValidSignature on the owner's Safe, deployed in the same simulated block. */
async function check(hash: Hex, signer = owner) {
    const account = await safeAccount(ref)
    const { factory, factoryData } = await account.getFactoryArgs()
    const { EIP712Domain: _, ...types } = safeMessage(chain.id, account.address, hash).types
    const signature = await signer.signTypedData({ ...safeMessage(chain.id, account.address, hash), types } as TypedDataDefinition)
    const { results } = await simulateCalls(publicClient, {
        calls: [
            { to: factory!, data: factoryData! },
            { to: account.address, abi: erc1271Abi, functionName: "isValidSignature", args: [hash, signature] },
        ],
    })
    assert.equal(results[0].status, "success", "Safe deployment in the simulation")
    return results[1]
}

test("the Safe accepts the owner's signature of a personal_sign message", async () => {
    const r = await check(hashMessage("Sign in to example.org\nNonce: 42"))
    assert.equal(r.status, "success")
    assert.equal(r.result, ERC1271_MAGIC)
})

test("the Safe accepts the owner's signature of EIP-712 data (Permit2-shaped)", async () => {
    const hash = hashTypedData({
        domain: { name: "Permit2", chainId: chain.id, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
        primaryType: "PermitSingle",
        types: {
            PermitSingle: [{ name: "details", type: "PermitDetails" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }],
            PermitDetails: [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }],
        },
        message: { details: { token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", amount: 1n, expiration: 1, nonce: 0 }, spender: stranger.address, sigDeadline: 1n },
    })
    const r = await check(hash)
    assert.equal(r.status, "success")
    assert.equal(r.result, ERC1271_MAGIC)
})

test("the Safe rejects a signature from someone else", async () => {
    const r = await check(hashMessage("hello"), stranger)
    assert.notEqual(r.result, ERC1271_MAGIC)
    assert.equal(r.status, "failure") // GS026: not an owner
})
