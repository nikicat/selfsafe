# 0001. Owner-signed 1-of-1 Safe with the ERC-4337 module

- Status: Accepted
- Date: 2026-09-26

## Context

The goal is an account whose address holds assets and positions long-term while the keys controlling it can be
replaced, whose owner can stay unlinkable (funded from Privacy Pools, never holding ETH), and which pays gas
without the owner holding ETH.

- An EOA cannot rotate its key; EIP-7702 does not help, since the key stays a master key (EIP-7851 was declined
  for Hegota; EIP-8151/8298 are years out).
- Ambire's smart account rotates keys but any single key can act, and Safes in Ambire run through Ambire's relay.
- Coinbase Smart Wallet allows cross-chain key rotation with one signature, but has no threshold and a
  vendor-bound interface.

## Decision

Use a Safe 1.4.1 with the canonical Safe 4337 module (v0.3.0) as fallback handler and module, 1-of-1 for now,
owner = an EOA in the user's browser wallet (hardware or passphrase account). The owner only signs EIP-712 data
(SafeOp, SafeMessage); it never sends transactions.

## Consequences

- Keys rotate with `swapOwner` per chain; the address is the same on every chain (CREATE2 over factory, setup and
  salt), and on a chain where it is not deployed yet it can only ever be deployed with the original owner.
- Every action is a UserOperation; ~40% more gas than an EOA (measured on Base and Arbitrum).
- Off-chain signatures go through ERC-1271 on the Safe (not yet verified with a real signature).
