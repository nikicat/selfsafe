# 0005. Neutral WalletConnect metadata, reinstalled after init

- Status: Accepted
- Date: 2026-09-26

## Context

Dapps receive the wallet's metadata at session approval. A distinctive name, URL or icon fingerprints the user and
the hosting location. Found in testing: `@walletconnect/utils` rewrites the metadata object passed to WalletKit,
replacing `url` with the page's real origin and adding its favicon as an icon.

## Decision

Send `{name: "Wallet", description: "", url: "https://wallet.invalid", icons: []}`, and after `WalletKit.init`
install fresh copies on `kit.metadata` and `kit.engine.signClient.metadata`. Do not imitate a real wallet
(MetaMask, Safe{Wallet}): dapps switch into wallet-specific behaviour that breaks.

## Consequences

- A test dapp receives only the neutral values (asserted in `test/app-e2e.js`).
- Relies on a WalletKit internal (`engine.signClient`); re-check on upgrades.
