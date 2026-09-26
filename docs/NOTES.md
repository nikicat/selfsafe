# Working notes

Facts a new session needs that are neither decisions ([adr/](adr/README.md)) nor tasks ([../TODO.md](../TODO.md)).

## Goal

A long-lived account whose keys can be rotated and whose owner can stay unlinkable: owner = a fresh passphrase
account on a hardware wallet, never funded; the Safe funded from Privacy Pools (USDT on Ethereum mainnet,
withdrawn through a relayer to the counterfactual address); gas paid by the Safe (ADR 0002); dapps used through
SelfSafe pinned with hash-pin (ADR 0004). The current test setup is *not* unlinkable (owner is a regular account).

## Test setup

| What | Value |
| --- | --- |
| Owner (test) | kept out of the repo (scripts take `OWNER=`), in Ambire in Firefox (default profile) |
| Safe (salt 0) | the owner's counterfactual Safe; its address and state stay out of the repo, like the owner |
| Reown project | ID in `.projectid` (gitignored); allowed domains include localhost |
| Signing from scripts | `browser-web3-signer evm sign-typed-data --file typed.json --address <owner> --chain <id>` opens the browser wallet |
| hash-pin | `~/src/hash-pin`, loaded as a temporary add-on via `about:debugging` (gone after a Firefox restart) |
| Local serving | `pnpm serve` → http://selfsafe.localhost:8791/ (hash-pin allows http only for localhost) |

## Environment quirks

- MetaMask and Enkrypt are installed system-wide (`/usr/lib/firefox/browser/extensions/`) and load into every
  Firefox profile; hash-pin's test harness sets `extensions.enabledScopes = 1` to keep them out.
- `/tmp` is a RAM-backed tmpfs, often nearly full: test profiles and builds live under the project directory.
- `mainnet.base.org` rate-limits bursts; `arb1.arbitrum.io` has no `eth_simulateV1` and no old state.
- Pimlico's public endpoint needs no key and allows browser CORS; rate-limited replies lack CORS headers.

## Measured costs

- Safe via 4337 vs plain EOA: ~1.4x gas (approve + swap on Base and Arbitrum).
- Pimlico ERC-20 paymaster markup ~1.1x; Ambire Gas Tank 1.7-2.9x of actual gas.

## History

`~/src/callrestricter` held the first harness and probe; superseded by this repo and can be deleted.
The architecture design doc (Claude Docs): https://claude.ai/code/artifact/6569ce96-d237-4a9c-80a8-38d0a418df17
