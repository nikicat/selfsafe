// Plain-language descriptions of typed data a dapp asks the Safe to sign. Off-chain signatures that grant spending
// (EIP-2612 permit, Permit2) leave no trace on-chain until used, so the card says what they allow and warns loudly.
import { decodeAbiParameters, formatUnits, getAddress, isAddressEqual, parseAbiParameters, slice, type Address, type Hex } from "viem"

export interface TokenInfo { symbol: string; decimals: number }
export interface Described { summary: string[]; warnings: string[] }
interface Context { chainId: number; safe: Address; now: number; token: (address: Address) => Promise<TokenInfo> }

const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3"
const MAX_UINT160 = 2n ** 160n - 1n // Permit2 amounts are uint160: max means unlimited
const MAX_UINT256 = 2n ** 256n - 1n
const NEVER = 2n ** 48n - 1n // Permit2 expirations are uint48: max means never
const LONG_SECONDS = 30 * 86400

export async function describeTypedData(typed: any, ctx: Context): Promise<Described> {
    const domain = typed.domain ?? {}, m = typed.message ?? {}, type: string = typed.primaryType
    const summary: string[] = [], warnings: string[] = []

    if (domain.chainId !== undefined && Number(domain.chainId) !== ctx.chainId)
        warnings.push(`this signature is for chain ${Number(domain.chainId)}, but the request came on chain ${ctx.chainId}`)

    const amount = async (token: Address, raw: unknown, max: bigint, spender: Address) => {
        const { symbol, decimals } = await ctx.token(token).catch(() => ({ symbol: `token ${token}`, decimals: 0 }))
        const v = BigInt(raw as string)
        if (v >= max) { warnings.push(`UNLIMITED ${symbol} for ${spender}`); return `UNLIMITED ${symbol}` }
        return `${formatUnits(v, decimals)} ${symbol}`
    }
    const until = (raw: unknown, what: string) => {
        const t = BigInt(raw as string)
        if (t >= NEVER || t > BigInt(ctx.now) + 100n * 365n * 86400n) { warnings.push(`${what} never expires`); return "with no expiry" }
        const secs = Number(t) - ctx.now
        if (secs < 0) return `(already expired ${new Date(Number(t) * 1000).toISOString()})`
        if (secs > LONG_SECONDS) warnings.push(`${what} stays valid for ${Math.round(secs / 86400)} days`)
        return `until ${new Date(Number(t) * 1000).toISOString().replace(".000Z", "Z")}`
    }

    const permit2 = !!domain.verifyingContract && isAddressEqual(domain.verifyingContract, PERMIT2)
    if (permit2 && (type === "PermitSingle" || type === "PermitBatch")) {
        const spender = getAddress(m.spender)
        for (const d of type === "PermitSingle" ? [m.details] : m.details)
            summary.push(`Permit2 allowance: ${spender} may spend up to ${await amount(getAddress(d.token), d.amount, MAX_UINT160, spender)} of the Safe's, ${until(d.expiration, "the allowance")}`)
    } else if (permit2 && /^Permit(Batch)?(Witness)?TransferFrom$/.test(type)) {
        const spender = getAddress(m.spender)
        for (const p of Array.isArray(m.permitted) ? m.permitted : [m.permitted])
            summary.push(`Permit2 transfer: ${spender} may take ${await amount(getAddress(p.token), p.amount, MAX_UINT256, spender)} from the Safe once, ${until(m.deadline, "the transfer permit")}`)
        if (type.includes("Witness")) summary.push(`with conditions the spender enforces (${Object.keys(typed.types).filter(t => !/^(EIP712Domain|TokenPermissions|Permit.*)$/.test(t)).join(", ") || "witness"})`)
    } else if (type === "Permit" && m.spender !== undefined && m.value !== undefined) { // EIP-2612
        const spender = getAddress(m.spender)
        summary.push(`Token permit: ${spender} may spend ${await amount(getAddress(domain.verifyingContract), m.value, MAX_UINT256, spender)} of the Safe's, ${until(m.deadline, "the permit")}`)
        if (m.owner && !isAddressEqual(m.owner, ctx.safe)) warnings.push(`the permit is for owner ${getAddress(m.owner)}, not this Safe`)
    } else if (type === "Permit" && m.allowed !== undefined) { // DAI-style
        const spender = getAddress(m.spender)
        const { symbol } = await ctx.token(getAddress(domain.verifyingContract)).catch(() => ({ symbol: "the token" }))
        if (m.allowed === true || m.allowed === "true") {
            warnings.push(`UNLIMITED ${symbol} for ${spender}`)
            summary.push(`Token permit: ${spender} may spend UNLIMITED ${symbol} of the Safe's, ${until(m.expiry || NEVER, "the permit")}`)
        } else summary.push(`Token permit: revokes ${spender}'s allowance for ${symbol}`)
        if (m.holder && !isAddressEqual(m.holder, ctx.safe)) warnings.push(`the permit is for holder ${getAddress(m.holder)}, not this Safe`)
    } else {
        summary.push(`${type} for ${domain.name ?? "an unnamed domain"}${domain.verifyingContract ? ` at ${getAddress(domain.verifyingContract)}` : ""}: not a known format; read the data below`)
    }
    return { summary, warnings }
}

// ---- LI.FI (Jumper and other front-ends) ----
// Every call to the LI.FI Diamond either bridges, with ILiFi.BridgeData as the first argument (whatever the bridge
// facet), or swaps on the same chain, with (transactionId, integrator, referrer, receiver, minAmountOut, ...) first.
// Both name the receiver, so one decoder covers all facets; bridge-specific data (destination amounts) is not read.

export const LIFI_DIAMOND = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE"
const NON_EVM_RECEIVER = "0x11f111f111f111F111f111f111F111f111f111F1" // LI.FI's placeholder; the real receiver is in facet data
const NON_EVM_CHAINS: Record<string, string> = { "1151111081099710": "Solana", "20000000000001": "Bitcoin", "9270000000000000": "Sui" }
const bridgeData = parseAbiParameters("(bytes32 transactionId, string bridge, string integrator, address referrer, address sendingAssetId, address receiver, uint256 minAmount, uint256 destinationChainId, bool hasSourceSwaps, bool hasDestinationCall)")
const swapHead = parseAbiParameters("bytes32 transactionId, string integrator, string referrer, address receiver")
const NATIVE = "0x0000000000000000000000000000000000000000"

interface LifiContext extends Context { nativeSymbol: string; chainName: (id: number) => string | undefined }

export async function describeLifiCall(data: Hex, value: bigint, ctx: LifiContext): Promise<Described> {
    const summary: string[] = [], warnings: string[] = []
    const args = `0x${data.slice(10)}` as Hex
    const receiverCheck = (receiver: Address, where: string) => {
        if (isAddressEqual(receiver, NON_EVM_RECEIVER)) warnings.push(`the receiver on ${where} is not an EVM address and is not decoded here; check it in the dapp`)
        else if (!isAddressEqual(receiver, ctx.safe)) warnings.push(`the receiver is ${receiver}, not this Safe`)
    }
    try {
        // A bridge call's first word is the offset of the (dynamic) BridgeData tuple; a swap's is a random transactionId.
        if (BigInt(slice(args, 0, 32)) < 0x10000n) {
            const [b] = decodeAbiParameters(bridgeData, args)
            const id = b.destinationChainId.toString()
            const managed = ctx.chainName(Number(b.destinationChainId))
            const where = NON_EVM_CHAINS[id] ?? managed ?? `chain ${id}`
            const sent = b.sendingAssetId === NATIVE ? `${formatUnits(b.minAmount, 18)} ${ctx.nativeSymbol}` : await tokenAmount(ctx, b.sendingAssetId, b.minAmount)
            summary.push(`LI.FI bridge via ${b.bridge}: sends ${sent} to ${b.receiver} on ${where}`)
            receiverCheck(b.receiver, where)
            if (!managed && !NON_EVM_CHAINS[id]) warnings.push(`the destination (chain ${id}) is not a chain SelfSafe manages: the Safe may not be usable there`)
            if (b.hasDestinationCall) warnings.push("the bridged funds are passed to a contract call on the destination chain; the final receiver is decided there")
        } else {
            const [, integrator, , receiver] = decodeAbiParameters(swapHead, args)
            summary.push(`LI.FI swap on this chain${integrator ? ` (via ${integrator})` : ""}: the output goes to ${receiver}${value ? `; sends ${formatUnits(value, 18)} ${ctx.nativeSymbol}` : ""}`)
            receiverCheck(receiver, "this chain")
        }
    } catch {
        warnings.push(`a LI.FI call (${data.slice(0, 10)}) that could not be decoded: the receiver is unknown`)
    }
    return { summary, warnings }
}

async function tokenAmount(ctx: Context, token: Address, raw: bigint) {
    const { symbol, decimals } = await ctx.token(token).catch(() => ({ symbol: `token ${token}`, decimals: 0 }))
    return `${formatUnits(raw, decimals)} ${symbol}`
}
