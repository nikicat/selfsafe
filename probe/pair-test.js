// Pairs a Node test dapp with the pinned probe page over the real WalletConnect relay and sends a request.
// Run from ~/src/callrestricter: node probe/pair-test.js
import { readFileSync, readdirSync } from "node:fs"
import { SignClient } from "@walletconnect/sign-client"
import { startHarness, until } from "../../hash-pin/test/harness.js"

const projectId = readFileSync(new URL("../.projectid", import.meta.url), "utf8").trim()
const dist = new URL("dist/", import.meta.url)
const files = Object.fromEntries(readdirSync(dist).map(n => [`/${n}`, readFileSync(new URL(n, dist))]))
const outText = `document.getElementById("out").textContent`
const readPage = async () => { try { return JSON.parse(await h.evaluate(h.app, outText)) } catch { return { steps: {}, violations: [] } } }

const h = await startHarness()
let dapp
try {
    h.sites.probe = { files, overrides: {}, log: [] }
    await h.pin("probe", `(() => { try { return JSON.parse(${outText}).done } catch { return false } })()`)
    console.log("pinned; page steps so far:", JSON.stringify(Object.fromEntries(Object.entries((await readPage()).steps).map(([k, v]) => [k, v.ok ? "ok" : v.detail]))))

    console.log("wallet metadata held:", await h.evaluate(h.app, "window.walletMetadata()"))
    dapp = await SignClient.init({ projectId, metadata: { name: "probe dapp", description: "", url: "https://dapp.invalid", icons: [] } })
    const { uri, approval } = await dapp.connect({ optionalNamespaces: { eip155: { chains: ["eip155:8453"], methods: ["personal_sign"], events: ["chainChanged"] } } })
    await h.evaluate(h.app, `window.walletPair(${JSON.stringify(uri)}).then(() => "paired")`)
    const session = await Promise.race([approval(), new Promise((_, rej) => setTimeout(() => rej(new Error("no session approval within 30s")), 30000))])
    const account = session.namespaces.eip155.accounts[0].split(":")[2]
    console.log(`dapp: session with "${session.peer.metadata.name}" (url ${session.peer.metadata.url}), account ${account}`)
    const result = await dapp.request({ topic: session.topic, chainId: "eip155:8453", request: { method: "personal_sign", params: ["0x68656c6c6f", account] } })
    console.log(`dapp: personal_sign result ${result}`)
    await until(async () => Object.keys((await readPage()).steps).length >= 9, "page to record the request", 15000).catch(() => {})
    const page = await readPage()
    for (const [k, v] of Object.entries(page.steps)) console.log(`${v.ok ? "ok  " : "FAIL"} ${k}: ${v.detail}`)
    console.log(`CSP violations: ${JSON.stringify(page.violations)}`)
} finally {
    await dapp?.core.relayer.transportClose().catch(() => {})
    await h.close()
    process.stdout.write("", () => process.exit(0)) // flush piped stdout before exiting
}
