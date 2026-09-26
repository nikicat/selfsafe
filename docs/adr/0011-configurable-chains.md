# 0011. Configurable chains with runtime capability checks

- Status: Proposed
- Date: 2026-09-26

## Context

The chain list is hardcoded in `src/core/chains.ts`. Adding chains should not need a release (and a new pin).

## Decision

Chains become user settings `{chainId, rpcUrl, bundlerUrl?}` with today's five as editable defaults. Before use, check:
`eth_chainId`, code at the canonical Safe singleton / proxy factory / 4337 module / MultiSend and EntryPoint v0.7,
bundler support for EntryPoint v0.7, a paymaster quote per gas token. A dapp's `wallet_addEthereumChain` becomes a
proposal the user confirms (its RPC URLs are untrusted). Refuse chains without the canonical contracts rather than
deploying infrastructure. Deploying the Safe itself on a chain gets an explicit action.

## Consequences

- Configuration lives in storage, so it does not change the pin value.
- Chain metadata (name, explorer) from a small bundled list or user input.
