# 0010. Activity log: chain events plus a local journal

- Status: Proposed
- Date: 2026-09-26

## Context

Users need a history of what the app did. The chain shows executed operations (including those made elsewhere,
e.g. via Ambire) but not which dapp asked, rejections, or off-chain signatures (ERC-1271, Permit2), which are the
most dangerous and leave no trace until used.

## Decision

Join two sources by UserOperation/transaction hash: chain scans per chain (`UserOperationEvent` with sender = Safe,
the Safe's `ExecutionSuccess`/`ExecutionFailure`) from the deployment block with the last scanned block cached; and a
local journal in IndexedDB with `navigator.storage.persist()` and JSON export/import for dapp, decoded action,
decisions and signatures.

## Consequences

- Complete execution history across devices; context only where the app ran.
- Log scans are bounded by RPC range limits; cache progress.
