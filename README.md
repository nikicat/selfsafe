# SelfSafe

A static web app that proxies dapp requests (WalletConnect) to a 1-of-1 Safe with the ERC-4337 module:
the owner signs in their browser wallet, gas is paid in stablecoins through a paymaster (or the Safe's own
ETH), and the app is pinned in Firefox with [hash-pin](../hash-pin) so its code changes only when you
re-pin.

Design: [Backendless Safe Wallet Proxy](https://claude.ai/code/artifact/6569ce96-d237-4a9c-80a8-38d0a418df17)

## Layout

| Path | What |
| --- | --- |
| `scripts/safe.ts` | CLI harness: address, prepare, sign off-box, submit a UserOp paid in USDT/USDC |
| `probe/` | Compatibility probe: runs viem, permissionless and WalletKit pinned under hash-pin's CSP and pairs with a test dapp over the real relay (`pnpm probe`; needs `probe/.projectid` with a Reown project ID and `../hash-pin`) |
