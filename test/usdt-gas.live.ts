// Mainnet USDT gas, simulated: USDT's approve reverts when changing one non-zero allowance to another, and every
// paymaster payment leaves some allowance behind (the paymaster takes the actual cost, less than the approved max).
// So from the second op on, the injected approve(paymaster, maxCost) must be preceded by approve(0).
// The op is built as prepareOp builds it (permissionless injects the approvals), except that paymaster data is the
// stub: Pimlico's real pm_getPaymasterData simulates against live state and refuses a Safe without USDT (AA50).
// Its callData then runs in eth_simulateV1 with the EntryPoint as sender (the 4337 module's executeUserOp accepts
// only the EntryPoint), after deploying the Safe, with a leftover allowance and a USDT balance injected.
// Not covered: the paymaster's own validation and postOp. Nothing is sent. Needs network.
// Run: tsx --test test/usdt-gas.live.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi, getAddress, http, keccak256, pad, parseAbi, toHex, type Address, type Hex } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { entryPoint07Address, type UserOperation } from "viem/account-abstraction"
import { simulateCalls } from "viem/actions"
import { createSmartAccountClient } from "permissionless"
import { prepareUserOperationForErc20Paymaster } from "permissionless/experimental/pimlico"
import { bundlerUrl, CHAINS } from "../src/core/chains"
import { clients, safeAccount, type SafeRef } from "../src/core/userop"

const USDT = CHAINS.mainnet.usdt
// TetherToken storage: balances at slot 2, allowed (owner => spender => amount) at slot 5
const mapSlot = (key: Address, slot: bigint) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [key, slot]))
const balanceSlot = (holder: Address) => mapSlot(holder, 2n)
const allowanceSlot = (owner: Address, spender: Address) => keccak256(encodeAbiParameters([{ type: "address" }, { type: "bytes32" }], [spender, mapSlot(owner, 5n)]))

const ref: SafeRef = { chainKey: "mainnet", owner: privateKeyToAccount(generatePrivateKey()).address }
const { chain, publicClient, bundler } = clients(ref)
const LEFTOVER = 12_345n // 0.012345 USDT still approved from an earlier op

/** prepareOp's token-mode op, with stub paymaster data in place of the real (state-checked) one. */
async function prepareWithStubPaymaster() {
    const account = await safeAccount(ref)
    const stub = { getPaymasterStubData: bundler.getPaymasterStubData, getPaymasterData: bundler.getPaymasterStubData }
    const client = createSmartAccountClient({
        account, chain, bundlerTransport: http(bundlerUrl(chain)), paymaster: stub, paymasterContext: { token: USDT },
        userOperation: {
            estimateFeesPerGas: async () => (await bundler.getUserOperationGasPrice()).fast,
            prepareUserOperation: prepareUserOperationForErc20Paymaster(bundler, { balanceOverride: true }),
        },
    })
    const calls = [{ to: USDT, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [account.address, 1n] }) }]
    const op = await client.prepareUserOperation({ calls }) as UserOperation<"0.7">
    return { account, op }
}

/** Deploy the Safe, then run `callData` as the EntryPoint would, with a leftover allowance; returns the final allowance. */
async function execute(safe: Address, factory: Address, factoryData: `0x${string}`, callData: `0x${string}`, paymaster: Address) {
    const { results } = await simulateCalls(publicClient, {
        account: entryPoint07Address,
        stateOverrides: [{ address: USDT, stateDiff: [
            { slot: balanceSlot(safe), value: pad(toHex(1_000_000_000n)) }, // 1000 USDT
            { slot: allowanceSlot(safe, paymaster), value: pad(toHex(LEFTOVER)) },
        ] }],
        calls: [
            { to: factory, data: factoryData },
            { to: safe, data: callData },
            { to: USDT, abi: erc20Abi, functionName: "allowance", args: [safe, paymaster] },
        ],
    })
    assert.equal(results[0].status, "success", "Safe deployment")
    return { executed: results[1].status === "success", allowance: results[2].result as bigint }
}

/** The calls in a Safe 4337 op's callData: executeUserOpWithErrorString(MultiSend, 0, multiSend(packed), DELEGATECALL).
 * permissionless's decodeCalls misparses this layout (it returns the approve selector as a `to` address). */
function multiSendCalls(callData: Hex) {
    const [, , outer] = decodeFunctionData({ abi: parseAbi(["function executeUserOpWithErrorString(address to, uint256 value, bytes data, uint8 operation)"]), data: callData }).args
    const [packed] = decodeFunctionData({ abi: parseAbi(["function multiSend(bytes transactions)"]), data: outer }).args
    const calls: { to: Address; value: bigint; data: Hex }[] = []
    for (let i = 2; i < packed.length; ) { // per call: operation (1 byte), to (20), value (32), data length (32), data
        const to = getAddress(`0x${packed.slice(i + 2, i + 42)}`)
        const value = BigInt(`0x${packed.slice(i + 42, i + 106)}`)
        const len = Number(BigInt(`0x${packed.slice(i + 106, i + 170)}`)) * 2
        calls.push({ to, value, data: `0x${packed.slice(i + 170, i + 170 + len)}` })
        i += 170 + len
    }
    return calls
}

test("mainnet USDT gas: the injected approve(0) lets the op run despite a leftover paymaster allowance", async () => {
    const { account, op } = await prepareWithStubPaymaster()
    const inner = multiSendCalls(op.callData)
    const approvals = inner.filter(c => c.to === getAddress(USDT) && c.data.startsWith("0x095ea7b3"))
        .map(c => decodeFunctionData({ abi: erc20Abi, data: c.data }).args as [Address, bigint])
    assert.equal(approvals.length, 2, "approve(0) and approve(maxCost) injected")
    const [[paymaster, reset], [, maxCost]] = approvals
    assert.equal(paymaster, op.paymaster)
    assert.equal(reset, 0n, "first approval resets to 0")
    assert.ok(maxCost > LEFTOVER)

    const withReset = await execute(account.address, op.factory!, op.factoryData!, op.callData, paymaster)
    assert.equal(withReset.executed, true, "op's calls executed")
    assert.equal(withReset.allowance, maxCost, "paymaster may now take up to maxCost")
    console.log(`deploy + transfer: up to ${Number(maxCost) / 1e6} USDT approved for gas`)

    // Control: the same batch without approve(0) must fail, or this test proves nothing
    const noReset = await account.encodeCalls(inner.slice(1))
    const withoutReset = await execute(account.address, op.factory!, op.factoryData!, noReset, paymaster)
    assert.equal(withoutReset.executed, false, "USDT refuses non-zero -> non-zero approve")
})
