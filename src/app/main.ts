// SelfSafe: dapps connect over WalletConnect and see the Safe; every transaction becomes a UserOperation the
// owner signs in their browser wallet, gas paid in a stablecoin (paymaster) or the Safe's ETH.
import { Core } from "@walletconnect/core"
import { WalletKit, type IWalletKit } from "@reown/walletkit"
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils"
import { decodeFunctionData, erc20Abi, formatEther, formatUnits, hashMessage, hashTypedData, hexToBytes, isAddress, isAddressEqual, maxUint256, type Address, type Hex } from "viem"
import { CHAINS, type ChainKey } from "../core/chains"
import { clients, prepareOp, safeAccount, submitOp, type Gas, type SignRequest } from "../core/userop"
import { discoverWallets, Owner, type WalletInfo } from "./owner"

declare const __PROJECT_ID__: string

// ---- small DOM helpers (no innerHTML: dapp-supplied strings are untrusted) ----
const $ = (id: string) => document.getElementById(id)!
type Child = Node | string | null | undefined | false
const present = (cs: Child[]) => cs.filter((c): c is Node | string => c !== null && c !== undefined && c !== false)
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
    const e = Object.assign(document.createElement(tag), props)
    e.append(...present(children))
    return e
}
const fill = (parent: Element, ...children: Child[]) => parent.replaceChildren(...present(children))
const code = (s: string) => el("code", {}, s)
function log(msg: string) {
    $("log").prepend(el("li", {}, `${new Date().toLocaleTimeString()} ${msg}`))
    console.info("selfsafe:", msg)
}
const status = (msg: string) => { $("status").textContent = msg }

// ---- settings (per browser; survive re-pins because the origin stays the same) ----
type GasChoice = "usdt" | "usdc" | "eth"
interface Settings { owner?: Address; gas: Partial<Record<ChainKey, GasChoice>> }
const settings: Settings = (() => { try { return { gas: {}, ...JSON.parse(localStorage.getItem("selfsafe") ?? "{}") } } catch { return { gas: {} } } })()
const save = () => { try { localStorage.setItem("selfsafe", JSON.stringify(settings)) } catch {} }

const CHAIN_KEYS = Object.keys(CHAINS) as ChainKey[]
const keyForChainId = (id: number) => CHAIN_KEYS.find(k => CHAINS[k].chain.id === id)
const gasChoice = (k: ChainKey): GasChoice => settings.gas[k] ?? "usdt"
const gasFor = (k: ChainKey): Gas => (gasChoice(k) === "eth" ? { kind: "native" } : { kind: "token", token: CHAINS[k][gasChoice(k) as "usdt" | "usdc"] })

let owner: Owner | null = null
let wallets: WalletInfo[] = []
let safe: Address | null = null
let kit: IWalletKit

const ref = (k: ChainKey) => ({ chainKey: k, owner: settings.owner! })

// ---- owner ----

function renderOwner() {
    const box = $("owner")
    box.replaceChildren()
    if (owner) box.append(el("p", {}, "Signing with ", el("strong", {}, owner.wallet.name), ": ", code(owner.address)))
    else if (settings.owner) box.append(el("p", {}, "Owner ", code(settings.owner), el("span", { className: "muted" }, " (remembered; connect the wallet to sign)")))
    else box.append(el("p", { className: "muted" }, "Connect the wallet that owns the Safe."))
    if (!owner) {
        if (!wallets.length) box.append(el("p", { className: "muted" }, "No browser wallet found."))
        for (const w of wallets) box.append(el("button", { onclick: () => connectOwner(w) }, `Connect ${w.name}`))
    }
}

async function connectOwner(w: WalletInfo) {
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {})
    try {
        owner = await Owner.connect(w)
        if (settings.owner && !isAddressEqual(settings.owner, owner.address)) log(`owner changed from ${settings.owner} to ${owner.address}`)
        settings.owner = owner.address
        save()
        log(`connected ${w.name} as ${owner.address}`)
        await loadSafe()
    } catch (e) { log(`wallet connection failed: ${(e as Error).message}`) }
    renderOwner()
    renderRequests()
}

// ---- Safe ----

async function loadSafe() {
    if (!settings.owner) return
    safe = (await safeAccount(ref("base"))).address // the same address on every chain (same factory, setup and salt)
    renderSafe()
    renderSessions()
}

function renderSafe() {
    const box = $("safe")
    if (!safe) return box.replaceChildren(el("p", { className: "muted" }, "Known once the owner is connected."))
    const rows = CHAIN_KEYS.map(k => {
        const select = el("select", { onchange: () => { settings.gas[k] = select.value as GasChoice; save() } },
            ...(["usdt", "usdc", "eth"] as const).map(g => el("option", { value: g, selected: gasChoice(k) === g }, g === "eth" ? "ETH (Safe pays)" : `${g.toUpperCase()} (paymaster)`)))
        const bal = el("td", { className: "mono muted" }, "…")
        const deployed = el("td", { className: "muted" }, "…")
        balances(k).then(b => { bal.textContent = b.text; bal.className = "mono"; deployed.textContent = b.deployed ? "deployed" : "not yet"; deployed.className = b.deployed ? "ok" : "muted" },
            () => { bal.textContent = "RPC error" })
        return el("tr", {}, el("td", {}, CHAINS[k].chain.name), deployed, bal, el("td", {}, select))
    })
    box.replaceChildren(
        el("p", {}, code(safe)),
        el("table", {}, el("tr", {}, el("th", {}, "Chain"), el("th", {}, "Safe"), el("th", {}, "Balances"), el("th", {}, "Gas")), ...rows))
}

async function balances(k: ChainKey) {
    const { publicClient } = clients(ref(k))
    const erc = (token: Address) => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [safe!] })
    const [code, eth, usdt, usdc] = await Promise.all([publicClient.getCode({ address: safe! }), publicClient.getBalance({ address: safe! }), erc(CHAINS[k].usdt), erc(CHAINS[k].usdc)])
    // USDT and USDC use 6 decimals on every chain in CHAINS
    return { deployed: !!code && code !== "0x", text: `${formatUnits(usdt, 6)} USDT · ${formatUnits(usdc, 6)} USDC · ${formatEther(eth)} ETH` }
}

// ---- WalletConnect ----

const METHODS = ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "eth_signTypedData", "eth_sign", "wallet_switchEthereumChain", "wallet_addEthereumChain"]
const EVENTS = ["chainChanged", "accountsChanged"]

async function startWalletKit() {
    const core = new Core({ projectId: __PROJECT_ID__ })
    // Dapps see this metadata. @walletconnect/utils rewrites the object passed in (url -> this page's origin,
    // icons -> its favicon), which would tell every dapp where the app is hosted; install fresh neutral objects after init.
    const neutral = () => ({ name: "Wallet", description: "", url: "https://wallet.invalid", icons: [] as string[] })
    kit = await WalletKit.init({ core, metadata: neutral() })
    kit.metadata = neutral()
    ;(kit as any).engine.signClient.metadata = neutral()
    kit.on("session_proposal", (e: any) => addRequest({ kind: "proposal", id: e.id, params: e.params, verify: e.verifyContext }))
    kit.on("session_request", (e: any) => addRequest({ kind: "request", id: e.id, topic: e.topic, params: e.params }))
    kit.on("session_delete", () => renderSessions())
}

function renderSessions() {
    const list = $("sessions")
    const sessions = kit ? Object.values(kit.getActiveSessions()) : []
    list.replaceChildren(...sessions.map((s: any) => el("li", {},
        el("strong", {}, s.peer.metadata.name || "(unnamed)"), " ", el("span", { className: "muted" }, s.peer.metadata.url), " ",
        el("button", { onclick: async () => { await kit.disconnectSession({ topic: s.topic, reason: getSdkError("USER_DISCONNECTED") }); renderSessions() } }, "Disconnect"))))
}

$("pair-form").addEventListener("submit", async e => {
    e.preventDefault()
    const input = $("pair-uri") as HTMLInputElement
    try { await kit.pair({ uri: input.value.trim() }); input.value = ""; log("pairing…") } catch (err) { log(`pairing failed: ${(err as Error).message}`) }
})

// ---- requests ----

type Req =
    | { kind: "proposal"; id: number; params: any; verify: any }
    | { kind: "request"; id: number; topic: string; params: any }
interface Card { req: Req; box: HTMLElement; state: "open" | "done" }
const cards: Card[] = []

function addRequest(req: Req) {
    const card: Card = { req, box: el("div", { className: "card" }), state: "open" }
    cards.push(card)
    const what = req.kind === "proposal" ? `connection from ${req.params.proposer.metadata.name}` : req.params.request.method
    log(`request: ${what}`)
    if (document.hidden && "Notification" in window && Notification.permission === "granted") new Notification("SelfSafe", { body: what })
    renderRequests()
    if (req.kind === "request") handleRequest(card).catch(e => fail(card, e))
    else renderCard(card)
}

function renderRequests() {
    const open = cards.filter(c => c.state === "open" || c.box.dataset.keep)
    $("requests").replaceChildren(...(open.length ? open.map(c => c.box) : [el("p", { className: "muted" }, "none")]))
}

const peerOf = (topic: string) => (kit.getActiveSessions() as any)[topic]?.peer.metadata ?? { name: "?", url: "?" }
const respond = (c: Card, result: unknown) => kit.respondSessionRequest({ topic: (c.req as any).topic, response: { id: c.req.id, jsonrpc: "2.0", result } })
const respondError = (c: Card, code: number, message: string) => kit.respondSessionRequest({ topic: (c.req as any).topic, response: { id: c.req.id, jsonrpc: "2.0", error: { code, message } } })

function finish(c: Card, ...lines: (Node | string)[]) {
    c.state = "done"
    c.box.dataset.keep = "1"
    c.box.replaceChildren(...lines.map(l => (typeof l === "string" ? el("p", {}, l) : l)))
    renderRequests()
    setTimeout(() => { delete c.box.dataset.keep; renderRequests() }, 30000)
}
function fail(c: Card, e: unknown) {
    const err = e as any
    const msg = [err?.shortMessage ?? err?.message ?? String(e), err?.details, err?.cause?.details].filter((x, i, a) => x && a.indexOf(x) === i).join(": ")
    log(`error: ${msg}`)
    c.box.append(el("p", { className: "bad" }, msg))
}
function rejectButton(c: Card) {
    return el("button", { className: "reject", onclick: async () => {
        if (c.req.kind === "proposal") await kit.rejectSession({ id: c.req.id, reason: getSdkError("USER_REJECTED") })
        else await respondError(c, 4001, "User rejected the request")
        finish(c, el("p", { className: "muted" }, "Rejected."))
    } }, "Reject")
}

function renderCard(c: Card) {
    const r = c.req
    if (r.kind !== "proposal") return
    const p = r.params.proposer.metadata
    const v = r.verify?.verified ?? {}
    const verdict = v.isScam ? el("strong", { className: "bad" }, "flagged as a scam") : v.validation === "VALID" ? el("span", { className: "ok" }, `domain verified (${v.origin})`) : el("span", { className: "bad" }, `domain not verified${v.origin ? ` (request came from ${v.origin})` : ""}`)
    fill(c.box,
        el("p", {}, el("strong", {}, p.name || "(unnamed dapp)"), " wants to connect ", el("span", { className: "muted" }, p.url)),
        el("p", {}, verdict),
        !safe ? el("p", { className: "bad" }, "Connect the owner wallet first (the Safe address is not known yet).") : null,
        el("button", { className: "primary approve", disabled: !safe, onclick: async () => {
            try {
                const chains = CHAIN_KEYS.map(k => `eip155:${CHAINS[k].chain.id}`)
                const namespaces = buildApprovedNamespaces({ proposal: r.params, supportedNamespaces: { eip155: { chains, methods: METHODS, events: EVENTS, accounts: chains.map(ch => `${ch}:${safe}`) } } })
                await kit.approveSession({ id: r.id, namespaces })
                log(`connected ${p.name}`)
                renderSessions()
                finish(c, el("p", { className: "ok" }, `Connected ${p.name}.`))
            } catch (e) { fail(c, e) }
        } }, "Approve"),
        rejectButton(c))
}

async function handleRequest(c: Card) {
    const r = c.req as Extract<Req, { kind: "request" }>
    const { method, params } = r.params.request
    const chainId = Number(String(r.params.chainId).split(":")[1])
    const key = keyForChainId(chainId)
    const peer = peerOf(r.topic)
    const head = el("p", {}, el("strong", {}, peer.name), " asks: ", code(method), key ? ` on ${CHAINS[key].chain.name}` : ` on unsupported chain ${chainId}`)
    c.box.replaceChildren(head)
    if (!key) return respondError(c, 4901, `chain ${chainId} is not supported`).then(() => finish(c, head, el("p", { className: "bad" }, "Unsupported chain; refused.")))
    if (!safe || !settings.owner) return fail(c, new Error("Connect the owner wallet to handle requests."))

    if (method === "eth_sendTransaction") return sendTransaction(c, head, key, params[0])
    if (method === "personal_sign" || method === "eth_signTypedData_v4") return signMessage(c, head, key, method, params)
    if (method === "wallet_switchEthereumChain") {
        await kit.emitSessionEvent({ topic: r.topic, event: { name: "chainChanged", data: chainId }, chainId: `eip155:${chainId}` })
        await respond(c, null)
        return finish(c, head, "Switched.")
    }
    await respondError(c, 4200, `${method} is not supported by this wallet`)
    finish(c, head, el("p", { className: "muted" }, "Not supported; refused."))
}

async function sendTransaction(c: Card, head: HTMLElement, key: ChainKey, tx: any) {
    if (tx.from && !isAddressEqual(tx.from, safe!)) throw new Error(`transaction is from ${tx.from}, not this Safe`)
    const call = { to: tx.to as Address, value: BigInt(tx.value ?? 0), data: (tx.data ?? tx.input ?? "0x") as Hex }
    const gas = gasFor(key)
    c.box.append(el("table", {},
        el("tr", {}, el("td", {}, "action"), el("td", { className: "describe" }, "…")),
        el("tr", {}, el("td", {}, "to"), el("td", {}, code(call.to))),
        el("tr", {}, el("td", {}, "value"), el("td", {}, `${formatEther(call.value)} ETH`)),
        el("tr", {}, el("td", {}, "data"), el("td", {}, call.data === "0x" ? "none" : code(`${call.data.slice(0, 10)}… (${(call.data.length - 2) / 2} bytes)`))),
        el("tr", {}, el("td", {}, "gas"), el("td", {}, gas.kind === "native" ? "ETH from the Safe" : `${gasChoice(key).toUpperCase()} via paymaster`))))
    describeCall(key, call).then(d => { c.box.querySelector(".describe")!.textContent = d }, () => { c.box.querySelector(".describe")!.textContent = "unknown call" })
    const note = el("p", { className: "muted prep" }, "Preparing…")
    c.box.append(note, rejectButton(c))
    const { op, typedData } = await prepareOp(ref(key), [call], gas)
    const maxGas = op.callGasLimit + op.verificationGasLimit + op.preVerificationGas + (op.paymasterVerificationGasLimit ?? 0n) + (op.paymasterPostOpGasLimit ?? 0n)
    note.className = "prep ready"
    note.textContent = `Ready to sign. Max gas cost ${formatEther(maxGas * op.maxFeePerGas)} ETH equivalent${op.factory ? "; this also deploys the Safe on this chain" : ""}.`
    const sign = el("button", { className: "primary sign", disabled: !owner, onclick: async () => {
        sign.disabled = true
        try {
            note.textContent = "Waiting for the owner's signature…"
            const signature = await owner!.signTypedData(CHAINS[key].chain.id, typedData)
            note.textContent = "Submitted; waiting for inclusion…"
            const res = await submitOp(ref(key), op, typedData as SignRequest, signature, h => { note.textContent = `Sent (UserOperation ${h}); waiting for inclusion…` })
            if (!res.success) throw new Error(`the operation reverted on-chain: ${res.explorer}`)
            await respond(c, res.txHash)
            log(`sent ${res.txHash}`)
            finish(c, head, el("p", { className: "ok" }, "Done: ", el("a", { href: res.explorer, target: "_blank", rel: "noreferrer" }, res.txHash)))
            renderSafe()
        } catch (e) { sign.disabled = false; fail(c, e) }
    } }, owner ? "Sign with owner and send" : "Connect the owner wallet to sign")
    c.box.insertBefore(sign, c.box.querySelector(".reject"))
}

/** Plain-language description of a call. Covers ERC-20 transfers and approvals; anything else shows its selector until simulation lands (M4). */
async function describeCall(key: ChainKey, call: { to: Address; value: bigint; data: Hex }) {
    if (call.data === "0x") return `send ${formatEther(call.value)} ETH`
    let decoded
    try { decoded = decodeFunctionData({ abi: erc20Abi, data: call.data }) } catch { return `contract call ${call.data.slice(0, 10)}${call.value ? ` with ${formatEther(call.value)} ETH` : ""}` }
    const { publicClient } = clients(ref(key))
    const token = { address: call.to, abi: erc20Abi } as const
    const [symbol, decimals] = await Promise.all([publicClient.readContract({ ...token, functionName: "symbol" }), publicClient.readContract({ ...token, functionName: "decimals" })])
    const amount = (v: bigint) => (v === maxUint256 ? `UNLIMITED ${symbol}` : `${formatUnits(v, decimals)} ${symbol}`)
    const [a0, a1] = decoded.args as [Address, bigint]
    if (decoded.functionName === "approve") return `approve ${a0} to spend ${amount(a1)} of the Safe's`
    if (decoded.functionName === "transfer") return `transfer ${amount(a1)} to ${a0}`
    return `${symbol}.${decoded.functionName}(${decoded.args?.map(String).join(", ")})`
}

/** ERC-1271: the owner signs the Safe-wrapped message; the Safe's isValidSignature must accept it before we answer. */
async function signMessage(c: Card, head: HTMLElement, key: ChainKey, method: string, params: any[]) {
    let hash: Hex, shown: string
    if (method === "personal_sign") {
        const [a, b] = params
        const msg = isAddress(a) && !isAddress(b) ? b : a // some dapps swap the parameters
        hash = hashMessage({ raw: msg as Hex })
        shown = (() => { try { return new TextDecoder("utf-8", { fatal: true }).decode(hexToBytes(msg as Hex)) } catch { return msg } })()
    } else {
        const typed = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1]
        const { EIP712Domain: _, ...types } = typed.types
        hash = hashTypedData({ ...typed, types })
        shown = JSON.stringify(typed.message, null, 2)
    }
    const chainId = CHAINS[key].chain.id
    const safeMessage = {
        domain: { chainId, verifyingContract: safe! }, primaryType: "SafeMessage",
        types: { EIP712Domain: [{ name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }], SafeMessage: [{ name: "message", type: "bytes" }] },
        message: { message: hash },
    }
    c.box.append(el("pre", { className: "mono" }, shown.slice(0, 2000)))
    const note = el("p", { className: "muted" }, "Signing a message makes it valid for the Safe (ERC-1271). Off-chain signatures can authorise spending (e.g. Permit2); read it first.")
    const sign = el("button", { className: "primary sign", disabled: !owner, onclick: async () => {
        sign.disabled = true
        try {
            const signature = await owner!.signTypedData(chainId, safeMessage)
            const { publicClient } = clients(ref(key))
            const magic = await publicClient.readContract({ address: safe!, abi: [{ type: "function", name: "isValidSignature", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "bytes" }], outputs: [{ type: "bytes4" }] }], functionName: "isValidSignature", args: [hash, signature] })
            if (magic !== "0x1626ba7e") throw new Error(`the Safe did not accept the signature (${magic})`)
            await respond(c, signature)
            finish(c, head, el("p", { className: "ok" }, "Signed."))
        } catch (e) { sign.disabled = false; fail(c, e) }
    } }, owner ? "Sign with owner" : "Connect the owner wallet to sign")
    c.box.append(note, sign, rejectButton(c))
}

// ---- start ----

;(window as any).selfsafe = { pair: (uri: string) => kit.pair({ uri }) } // for the end-to-end test
discoverWallets(w => { wallets = w; renderOwner() })
renderOwner()
renderSafe()
loadSafe().catch(e => log(`Safe: ${(e as Error).message}`))
startWalletKit()
    .then(() => { status("ready"); renderSessions() })
    .catch(e => { status("WalletConnect failed to start"); log((e as Error).message) })
