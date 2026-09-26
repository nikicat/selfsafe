import { test } from "node:test"
import assert from "node:assert/strict"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import type { UserOperation } from "viem/account-abstraction"
import { opFromJson, submitOp, toJson, typedDataFromJson, type SignRequest } from "../src/core/userop"

const op = { sender: "0x124Ef647181eda69861b61596802129E3B018765", nonce: 5n, callData: "0x", callGasLimit: 1n, verificationGasLimit: 2n, preVerificationGas: 3n, maxFeePerGas: 4n, maxPriorityFeePerGas: 5n, signature: "0x" } as unknown as UserOperation<"0.7">
const typed = {
    domain: { chainId: 8453, verifyingContract: "0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226" },
    primaryType: "SafeOp",
    types: { EIP712Domain: [{ name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], SafeOp: [{ name: "nonce", type: "uint256" }] },
    message: { nonce: 5n },
} as unknown as SignRequest

test("ops and typed data survive JSON with their bigints", () => {
    assert.deepEqual(opFromJson(toJson(op)), op)
    assert.equal(typedDataFromJson(toJson(typed)).message.nonce, 5n)
})

test("submitOp refuses a signature that is not the owner's, before touching the network", async () => {
    const owner = privateKeyToAccount(generatePrivateKey())
    const stranger = privateKeyToAccount(generatePrivateKey())
    const { EIP712Domain: _, ...types } = typed.types
    const signature = await stranger.signTypedData({ ...typed, types } as never)
    await assert.rejects(submitOp({ chainKey: "base", owner: owner.address }, op, typed, signature), /signature is from .* expected the owner/)
})
