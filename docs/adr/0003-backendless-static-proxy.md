# 0003. Backendless static web app proxying dapps over WalletConnect

- Status: Accepted
- Date: 2026-09-26

## Context

No existing wallet offers a Safe + 4337 module + ERC-20 paymaster for dapp connections (Safe{Wallet} has no 4337
path; Ambire routes Safes through its relay). Options considered: a local daemon speaking WalletConnect, a hosted
Safe{Wallet} fork (needs Transaction Service and Client Gateway backends), a static single-page app.

## Decision

A static single-page app with no backend of its own: WalletKit (wallet side) toward dapps, EIP-6963/EIP-1193
toward the owner's wallet, the UserOp library in the page, public RPC and bundler endpoints. For a 1-of-1 Safe
there is no signature queue to coordinate, so no backend is needed.

## Consequences

- Nothing to run but a static file server; the page holds no keys.
- Notifications only while the tab is open (no push without a server).
- WalletConnect needs a Reown project ID; Reown sees the origin, IPs and the project ID.
- Whoever serves the code decides what the owner is asked to sign: see ADR 0004.
