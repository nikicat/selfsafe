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

test("sendWithRetry retries rate limits and network errors, stops when the bundler has the op, rethrows the rest", async () => {
    const { HttpRequestError, RpcRequestError } = await import("viem")
    const { sendWithRetry } = await import("../src/core/userop")
    const rateLimited = new HttpRequestError({ url: "https://bundler.invalid", status: 429 })
    const networkError = new HttpRequestError({ url: "https://bundler.invalid" }) // what a CORS-less 429 looks like in a browser
    const failing = (...errors: Error[]) => { let n = 0; return async () => { if (n < errors.length) throw errors[n++]; return "0xhash" } }
    let sends = 0
    const counted = (f: () => Promise<unknown>) => () => (sends++, f())

    assert.equal(await sendWithRetry(counted(failing(rateLimited, networkError)), async () => false, [1, 1, 1]), "0xhash")
    assert.equal(sends, 3, "two transient failures, then success")

    sends = 0
    assert.equal(await sendWithRetry(counted(failing(networkError, networkError)), async () => true, [1, 1, 1]), undefined)
    assert.equal(sends, 1, "the bundler already has the op: no resend")

    const rejected = new RpcRequestError({ url: "https://bundler.invalid", body: {}, error: { code: -32500, message: "AA25 invalid account nonce" } })
    await assert.rejects(sendWithRetry(failing(rejected), async () => false, [1]), /AA25/)
    await assert.rejects(sendWithRetry(failing(rateLimited, rateLimited, rateLimited), async () => false, [1, 1]), HttpRequestError, "gives up after the last delay")
})
