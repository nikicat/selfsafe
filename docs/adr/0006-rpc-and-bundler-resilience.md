# 0006. Public RPCs: publicnode defaults, batching, tolerant polling

- Status: Accepted
- Date: 2026-09-26

## Context

Observed: `mainnet.base.org` answered `over rate limit` while the app loaded balances for five chains; load-balanced
public RPCs returned stale state after inclusion and even "block not found" for a just-included block; Pimlico's
public endpoint, when rate-limited, answers without CORS headers, which a browser reports as a bare network error.
One such error aborted a receipt wait after the operation had already executed.

## Decision

Default RPCs are publicnode (CORS allowed, `eth_simulateV1` supported) with JSON-RPC batching; per-call override
kept. Receipts are polled every 2 s tolerating transient errors, up to 3 minutes; the UserOperation hash is shown as
soon as the bundler accepts it. Post-inclusion reads use the receipt's block number, retried until a node has it.

## Consequences

- Fewer, larger requests; an operation is never "lost" by the UI.
- Still public infrastructure: configurable RPCs are planned (ADR 0011).
