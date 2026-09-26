# 0007. Build: one SRI-covered bundle, reproducible, no eval/inline/wasm

- Status: Accepted
- Date: 2026-09-26

## Context

hash-pin requires `index.html` to commit to every file, and enforces `script-src 'self'` without `unsafe-eval`,
inline scripts or WebAssembly, `connect-src https: wss:`, `frame-src 'none'`. The library stack (viem,
permissionless, WalletKit) was checked with `probe/`: all paths ran pinned with no CSP violations, including real
relay pairing and requests; the WebAssembly bundled by `@walletconnect/pay` never loads.

## Decision

esbuild bundles the app into one script and one stylesheet with SRI hashes in `index.html`; the icon is inlined as a
`data:` URL. No inline scripts, `eval` or WebAssembly. The Reown project ID is a build input (`PROJECT_ID` or
`.projectid`).

## Consequences

- Builds are byte-reproducible (checked: local and container builds identical), so anyone can recompute the pin value.
- Each operator's project ID yields a different pin value.
- New dependencies must pass the probe (`pnpm probe`).
