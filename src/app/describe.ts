// Plain-language descriptions of typed data a dapp asks the Safe to sign. Off-chain signatures that grant spending
// (EIP-2612 permit, Permit2) leave no trace on-chain until used, so the card says what they allow and warns loudly.
import { formatUnits, getAddress, isAddressEqual, type Address } from "viem"

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
