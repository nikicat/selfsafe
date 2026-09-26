# TODO

## Next

- [ ] **Decode LI.FI calls** (Jumper): show receiver, destination chain, minimum amount and bridge from
      `BridgeData` / swap data. A cross-chain swap shows only a selector; a wrong receiver or destination would
      be invisible, and simulation (M4) cannot see cross-chain delivery either.

## Milestones (design doc)

- [ ] M3 Batching: `wallet_sendCalls` / `wallet_getCallsStatus` (EIP-5792); approve + swap as one UserOp.
- [ ] M4 Guard: simulation diff before signing, on-chain postconditions in the same batch, typed-data warnings
      (Permit2, approvals).

## Open checks

- [ ] ERC-1271: a real owner signature accepted by the Safe's `isValidSignature` through the 4337 module as
      fallback handler (only probed with an empty signature so far).
- [ ] Mainnet USDT gas path (`approve(0)` reset) with a small amount.
- [ ] Decoding beyond ERC-20 approve/transfer (known routers, Permit2).
- [ ] hash-pin: service worker verification is designed but untested.
