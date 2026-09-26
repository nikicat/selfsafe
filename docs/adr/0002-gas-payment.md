# 0002. Gas: Pimlico ERC-20 paymaster or the Safe's own ETH

- Status: Accepted
- Date: 2026-09-26

## Context

The owner must not need ETH (unlinkability; convenience). Measured on Base and Arbitrum: Ambire's Gas Tank charged
1.7-2.9x the actual gas cost; Pimlico's ERC-20 paymaster ~1.1x. Ambire's interface refuses Safe self-payment in
ETH (`'not supported'` for any Safe-paid, non-Gas-Tank fee option). Safe{Wallet} only executes via an EOA paying
ETH.

## Decision

Two modes per chain, chosen by the user: `token` (Pimlico ERC-20 paymaster, repaid by the Safe in USDT/USDC, with
`approve(paymaster, maxFee)` injected, plus `approve(0)` first for mainnet USDT) and `native` (no paymaster, the
Safe prefunds the EntryPoint). Public keyless Pimlico endpoints.

## Consequences

- Works with no ETH anywhere; ~10% markup in token mode, none in native mode.
- Depends on Pimlico's public endpoint (rate limits, availability); native mode is the fallback.
- The mainnet USDT `approve(0)` path is untested.
