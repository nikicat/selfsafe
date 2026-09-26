# 0009. One running instance serving multiple Safes

- Status: Proposed
- Date: 2026-09-26

## Context

All tabs of one origin share a WalletConnect client identity (IndexedDB), so two open SelfSafe tabs would both answer
every request, already a bug with one Safe. Supporting several Safes could be one tab per Safe (separate storage
prefixes, a lock per Safe) or one instance serving all.

## Decision

Take a Web Lock at start so only one instance runs; a second tab shows "open in another tab". That instance serves
several Safes `{label, owner, saltNonce}`: each dapp session is bound to one Safe chosen on the proposal card, and
requests route by session. At signing time the connected owner account must match that Safe's owner.

## Consequences

- The Web Lock is implemented (`src/app/main.ts`); a waiting tab takes over when the running one closes.
- One relay connection and one place for notifications.
- A new Safe is a new salt, deployed on first use.
