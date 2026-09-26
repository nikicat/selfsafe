// The Safe owner's wallet, found via EIP-6963 (e.g. Ambire). It only ever signs EIP-712 data for us.
import { numberToHex, type Address, type Hex } from "viem"

interface Eip1193 { request(args: { method: string; params?: unknown[] }): Promise<any> }
export interface WalletInfo { uuid: string; name: string; rdns: string; provider: Eip1193 }

const wallets: WalletInfo[] = []
export function discoverWallets(onChange: (w: WalletInfo[]) => void) {
    window.addEventListener("eip6963:announceProvider", (e: any) => {
        if (wallets.some(w => w.uuid === e.detail.info.uuid)) return // some wallets announce repeatedly
        wallets.push({ ...e.detail.info, provider: e.detail.provider })
        onChange([...wallets])
    })
    window.dispatchEvent(new Event("eip6963:requestProvider"))
}

export class Owner {
    constructor(readonly wallet: WalletInfo, readonly address: Address) {}

    static async connect(wallet: WalletInfo) {
        const [address] = await wallet.provider.request({ method: "eth_requestAccounts" })
        return new Owner(wallet, address)
    }

    /** Sign EIP-712 data (types include EIP712Domain). Wallets refuse a domain chainId other than their current chain, so switch first. */
    async signTypedData(chainId: number, typedData: unknown): Promise<Hex> {
        const current = Number(await this.wallet.provider.request({ method: "eth_chainId" }))
        if (current !== chainId) await this.wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: numberToHex(chainId) }] })
        const json = JSON.stringify(typedData, (_, v) => (typeof v === "bigint" ? v.toString() : v))
        return this.wallet.provider.request({ method: "eth_signTypedData_v4", params: [this.address, json] })
    }
}
