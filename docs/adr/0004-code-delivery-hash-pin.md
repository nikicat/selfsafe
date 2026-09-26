# 0004. Code delivery: plain static site pinned with hash-pin

- Status: Accepted
- Date: 2026-09-26

## Context

The app builds what the owner signs, so its code must not change without the user's consent. Browsers cannot pin
a page to a hash. Checked and rejected: IPFS via HTTP gateways (trust moves to the gateway), IPFS local node
(needs a daemon), service-worker gateway (trusts its publisher), extension-as-app (Ambire does not inject into
extension pages), `file://` (Firefox wallets do not inject there: tested), WAICT/WEBCAT (site-controlled roots,
prototypes), Isolated Web Apps (not generally available).

## Decision

Ship a normal `https://` static site whose `index.html` commits to every other file with SRI. Users pin it with
hash-pin (our Firefox extension, `~/src/hash-pin`): origin -> sha256(index.html), every same-origin response
verified, a strict CSP enforced, updates blocked until re-pinned.

## Consequences

- Verified with Ambire: injects, connects and signs on a pinned page; Enkrypt cannot (inline-script injection is
  blocked by the CSP).
- Firefox only. Each release has a pin value users compare; the build must be reproducible (ADR 0007).
- Settings and WalletConnect sessions survive re-pins (same origin).
