// End-to-end, headless: the built app pinned with hash-pin, paired with a Node test dapp over the real relay.
// Covers everything up to the owner's signature (which needs a real wallet): session approval with neutral
// metadata, eth_sendTransaction prepared into a signable UserOp, rejection reaching the dapp, no CSP errors.
// Run: pnpm build && node test/app-e2e.js
import { readFileSync, readdirSync } from "node:fs"
import assert from "node:assert/strict"
import { SignClient } from "@walletconnect/sign-client"
import { startHarness, until } from "../../hash-pin/test/harness.js"

const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
const SAFE = "0x124Ef647181eda69861b61596802129E3B018765"
const projectId = readFileSync(new URL("../.projectid", import.meta.url), "utf8").trim()
const dist = new URL("../dist/app/", import.meta.url)
const files = Object.fromEntries(readdirSync(dist).map(n => [`/${n}`, readFileSync(new URL(n, dist))]))

const h = await startHarness()
const consoleErrors = []
await h.bidi("session.subscribe", { events: ["log.entryAdded"] })
h.onEvent(m => { if (m.method === "log.entryAdded" && m.params.level === "error") consoleErrors.push(m.params.text) })
const page = expr => h.evaluate(h.app, expr)
let dapp, failed = false
try {
    h.sites.selfsafe = { files, overrides: {}, log: [] }
    const ready = `document.getElementById("status").textContent === "ready" && !!document.querySelector("#safe code")`
    // Remember an owner before pinning; the origin (and its storage) stays the same across the pin.
    await h.load("selfsafe", `document.getElementById("status").textContent === "ready"`)
    await page(`localStorage.setItem("selfsafe", JSON.stringify({ owner: "${OWNER}", gas: { base: "usdt" } }))`)
    await h.pin("selfsafe", ready)
    assert.equal(await page(`document.querySelector("#safe code").textContent`), SAFE)
    console.log("ok   pinned app shows the Safe for the remembered owner")

    dapp = await SignClient.init({ projectId, metadata: { name: "e2e dapp", description: "", url: "https://dapp.invalid", icons: [] } })
    const { uri, approval } = await dapp.connect({ optionalNamespaces: { eip155: { chains: ["eip155:8453"], methods: ["eth_sendTransaction", "personal_sign"], events: ["chainChanged"] } } })
    await page(`window.selfsafe.pair(${JSON.stringify(uri)}).then(() => true)`)
    await until(() => page(`!!document.querySelector("#requests button.approve:not([disabled])")`), "session proposal card", 30000)
    await page(`document.querySelector("#requests button.approve").click()`)
    const session = await approval()
    assert.deepEqual(session.peer.metadata, { name: "Wallet", description: "", url: "https://wallet.invalid", icons: [] })
    assert.equal(session.namespaces.eip155.accounts.find(a => a.startsWith("eip155:8453:")), `eip155:8453:${SAFE}`)
    console.log("ok   session approved; the dapp sees only neutral metadata and the Safe address")

    const request = dapp.request({ topic: session.topic, chainId: "eip155:8453", request: { method: "eth_sendTransaction", params: [{ from: SAFE, to: OWNER, value: "0x0", data: "0x" }] } })
    await until(() => page(`!!document.querySelector("#requests .prep.ready")`), "UserOp prepared", 45000)
    assert.match(await page(`document.querySelector("#requests .prep").textContent`), /Ready to sign\. Max gas cost/)
    assert.equal(await until(() => page(`document.querySelector("#requests .describe")?.textContent !== "…" && document.querySelector("#requests .describe").textContent`), "call description"), "send 0 ETH")
    console.log("ok   eth_sendTransaction prepared into a signable UserOp (USDT gas via paymaster)")

    await page(`document.querySelector("#requests button.reject").click()`)
    await assert.rejects(request, e => e.code === 4001 || /rejected/i.test(e.message))
    console.log("ok   rejecting in the app reaches the dapp as a user rejection")

    const csp = consoleErrors.filter(t => /Content-Security-Policy|Content Security Policy/i.test(t))
    assert.deepEqual(csp, [], `CSP errors: ${csp.join("\n")}`)
    console.log("ok   no CSP errors")
} catch (e) {
    failed = true
    console.log(`FAIL ${e.message}`)
    console.log("page log:", await page(`document.getElementById("log").innerText`).catch(x => x.message))
} finally {
    await dapp?.core.relayer.transportClose().catch(() => {})
    await h.close()
    process.stdout.write("", () => process.exit(failed ? 1 : 0))
}
