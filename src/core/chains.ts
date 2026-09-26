import type { Address, Chain } from "viem"
import { arbitrum, base, mainnet, optimism, polygon } from "viem/chains"

/** Chains the app supports, with the stablecoins Pimlico's ERC-20 paymaster accepts there (checked via pimlico_getTokenQuotes). */
export const CHAINS = {
    mainnet: { chain: mainnet, usdt: "0xdAC17F958D2ee523a2206206994597C13D831ec7", usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    arbitrum: { chain: arbitrum, usdt: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", usdc: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" },
    optimism: { chain: optimism, usdt: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", usdc: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" },
    base: { chain: base, usdt: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }, // Base USDT is bridged
    polygon: { chain: polygon, usdt: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
} as const satisfies Record<string, { chain: Chain; usdt: Address; usdc: Address }>

export type ChainKey = keyof typeof CHAINS

export const bundlerUrl = (chain: Chain) => `https://public.pimlico.io/v2/${chain.id}/rpc`
