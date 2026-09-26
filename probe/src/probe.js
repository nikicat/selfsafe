// Compatibility probe: run the library paths the app needs and record CSP violations.
// Results land in <pre id="out"> as JSON for the runner (and a human) to read.
import { createPublicClient, hashTypedData, http, recoverTypedDataAddress } from "viem"
import { generatePrivateKey, privateKeyToAccount, toAccount } from "viem/accounts"
import { entryPoint07Address } from "viem/account-abstraction"
import { base } from "viem/chains"
import { toSafeSmartAccount } from "permissionless/accounts"
import { createPimlicoClient } from "permissionless/clients/pimlico"
import { Core } from "@walletconnect/core"
import { WalletKit } from "@reown/walletkit"
import { buildApprovedNamespaces } from "@walletconnect/utils"

const result = { steps: {}, violations: [], done: false }
const out = document.getElementById("out")
const show = () => { out.textContent = JSON.stringify(result, null, 2) }
document.addEventListener("securitypolicyviolation", e => {
    result.violations.push({ directive: e.violatedDirective, blocked: e.blockedURI, sample: e.sample, at: `${e.sourceFile}:${e.lineNumber}` })
    show()
})
let kit
const until = async (fn, ms) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) throw new Error(`timeout ${ms}ms`); await new Promise(r => setTimeout(r, 100)) } }
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms))])
async function step(name, fn) {
    try { result.steps[name] = { ok: true, detail: String(await withTimeout(fn(), 20000)) } }
    catch (e) { result.steps[name] = { ok: false, detail: `${e?.name}: ${e?.shortMessage ?? e?.message ?? e}` } }
    show()
}

const client = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") })
const typed = { domain: { name: "probe", version: "1", chainId: 8453 }, primaryType: "M", types: { M: [{ name: "x", type: "uint256" }] }, message: { x: 1n } }

await step("viem: read block over RPC", async () => `block ${await client.getBlockNumber()}`)
await step("viem: sign + recover typed data", async () => {
    const acct = privateKeyToAccount(generatePrivateKey())
    const sig = await acct.signTypedData(typed)
    const who = await recoverTypedDataAddress({ ...typed, signature: sig })
    if (who !== acct.address) throw new Error("recovered wrong address")
    return hashTypedData(typed).slice(0, 18)
})
await step("permissionless: Safe account address", async () => {
    const nope = async () => { throw new Error("no signing in probe") }
    const owner = toAccount({ address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", signMessage: nope, signTransaction: nope, signTypedData: nope })
    const safe = await toSafeSmartAccount({ client, owners: [owner], version: "1.4.1", entryPoint: { address: entryPoint07Address, version: "0.7" }, saltNonce: 0n })
    return safe.address
})
await step("permissionless: Pimlico gas price", async () => {
    const pimlico = createPimlicoClient({ chain: base, transport: http("https://public.pimlico.io/v2/8453/rpc"), entryPoint: { address: entryPoint07Address, version: "0.7" } })
    return `fast maxFeePerGas ${(await pimlico.getUserOperationGasPrice()).fast.maxFeePerGas}`
})
await step("walletconnect: approved namespaces (utils)", async () => {
    const ns = buildApprovedNamespaces({
        proposal: { id: 1, requiredNamespaces: {}, optionalNamespaces: { eip155: { chains: ["eip155:8453"], methods: ["eth_sendTransaction"], events: ["chainChanged"] } }, proposer: { publicKey: "00", metadata: { name: "d", description: "d", url: "https://d.example", icons: [] } }, relays: [{ protocol: "irn" }], expiryTimestamp: 0, pairingTopic: "t" },
        supportedNamespaces: { eip155: { chains: ["eip155:8453"], methods: ["eth_sendTransaction"], events: ["chainChanged"], accounts: ["eip155:8453:0x124Ef647181eda69861b61596802129E3B018765"] } },
    })
    return Object.keys(ns).join(",")
})
await step("walletkit: init + relay connect", async () => {
    const core = new Core({ projectId: __PROJECT_ID__ })
    // Generic metadata: dapps see this, so it must not identify the app or where it is hosted.
    // Dapps see this metadata. @walletconnect/utils rewrites the object passed in (url -> the page's real origin,
    // icons -> the page's favicon), which would tell every dapp where this app is hosted. So after init, give the
    // SignClient that sends it a fresh neutral object.
    const neutral = () => ({ name: "Wallet", description: "", url: "https://wallet.invalid", icons: [] })
    kit = await WalletKit.init({ core, metadata: neutral() })
    kit.metadata = neutral()
    kit.engine.signClient.metadata = neutral()
    kit.on("session_proposal", async ({ id, params }) => {
        await step("walletkit: approve session", async () => {
            const namespaces = buildApprovedNamespaces({ proposal: params, supportedNamespaces: {
                eip155: { chains: ["eip155:8453"], methods: ["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"], events: ["chainChanged", "accountsChanged"], accounts: ["eip155:8453:0x124Ef647181eda69861b61596802129E3B018765"] },
            } })
            const session = await kit.approveSession({ id, namespaces })
            return `peer "${session.peer.metadata.name}", topic ${session.topic.slice(0, 8)}…`
        })
    })
    kit.on("session_request", async ({ id, topic, params }) => {
        await step(`walletkit: answer ${params.request.method}`, async () => {
            await kit.respondSessionRequest({ topic, response: { id, jsonrpc: "2.0", result: "0xprobe" } })
            return "answered"
        })
    })
    return "initialized (the relay connects on the first pairing)"
})
// The runner calls this with a dapp's wc: URI, and inspects the metadata actually held by the clients.
window.walletPair = uri => kit.pair({ uri })
window.walletMetadata = () => JSON.stringify({ kit: kit.metadata, signClient: kit.engine.signClient.metadata, same: kit.metadata === kit.engine.signClient.metadata })
result.done = true
show()
