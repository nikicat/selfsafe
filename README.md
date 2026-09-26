# SelfSafe

A static web app that proxies dapp requests (WalletConnect) to a 1-of-1 Safe with the ERC-4337 module:
the owner signs in their browser wallet, gas is paid in stablecoins through a paymaster (or the Safe's own
ETH), and the app is pinned in Firefox with [hash-pin](../hash-pin) so its code changes only when you
re-pin.

Design: [Backendless Safe Wallet Proxy](https://claude.ai/code/artifact/6569ce96-d237-4a9c-80a8-38d0a418df17)

Deploying: [docs/DEPLOY.md](docs/DEPLOY.md) (container image, Quadlet unit, HTTPS, pin values). Open work: [TODO.md](TODO.md).

## Develop

```sh
pnpm install
pnpm build          # dist/app, prints the pin value (needs .projectid or PROJECT_ID)
pnpm serve          # http://selfsafe.localhost:8791/
pnpm test && pnpm typecheck
node test/app-e2e.js   # headless Firefox + hash-pin + real WalletConnect relay (needs ../hash-pin)
```

## Layout

| Path | What |
| --- | --- |
| `src/app/` | The static app (WalletKit, owner connector, request cards) |
| `src/core/` | Browser-safe UserOp library: prepare, owner typed data, submit; chain and token table |
| `scripts/safe.ts` | CLI over `src/core`: address, prepare, sign off-box, submit (USDT/USDC gas or ETH) |
| `scripts/build-app.js` | Reproducible build of `dist/app` with SRI and the inlined icon |
| `deploy/` | Containerfile, Caddyfile, Quadlet unit |
| `assets/icon.svg` | App icon |
| `probe/` | Compatibility probe: runs viem, permissionless and WalletKit pinned under hash-pin's CSP and pairs with a test dapp over the real relay (`pnpm probe`; needs `probe/.projectid` with a Reown project ID and `../hash-pin`) |
