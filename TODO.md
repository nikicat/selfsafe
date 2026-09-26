# TODO

## Next

- [ ] **Decode LI.FI calls** (Jumper): show receiver, destination chain, minimum amount and bridge from
      `BridgeData` / swap data. A cross-chain swap shows only a selector; a wrong receiver or destination would
      be invisible, and simulation (M4) cannot see cross-chain delivery either.
- [ ] **Chains without a hardcoded list** (ADR 0011). Chains become user settings `{chainId, rpcUrl, bundlerUrl?}` with the
      current five as editable defaults. For each chain, check at runtime rather than trust a table:
      `eth_chainId` matches, the canonical Safe 1.4.1 singleton / proxy factory / 4337 module / MultiSend and
      EntryPoint v0.7 have code, the bundler lists EntryPoint v0.7, and each configured gas token gets a paymaster
      quote. Chain name and explorer from a small bundled list, else user-entered. Session namespaces follow
      the configured chains; `wallet_addEthereumChain` from a dapp becomes a proposal the user confirms (its RPC
      URLs are untrusted). Config is data in storage, not code, so it does not affect the pin.
- [ ] **Activity log that persists** (ADR 0010, proposed). Two sources, joined by UserOperation / transaction hash:
      - the chain is the source of truth for what executed: `UserOperationEvent` (EntryPoint, sender = Safe) and
        the Safe's `ExecutionSuccess`/`ExecutionFailure`, scanned per chain from the deployment block, with the last
        scanned block cached. It also shows operations made elsewhere (e.g. through Ambire);
      - a local journal (IndexedDB, `navigator.storage.persist()`, export/import as JSON) holds what the chain
        cannot: which dapp asked, the decoded action, rejections, and above all **off-chain signatures**
        (ERC-1271, Permit2), which leave no trace on-chain until someone uses them.
- [ ] **Multiple Safes** (ADR 0009, proposed). Direction: the one running instance (Web Lock, done) serving several Safes, not
      one tab per Safe. Each dapp session is bound to one Safe, chosen on the proposal card (its accounts are that
      Safe's address), and requests route by session. Safes are `{label, owner, saltNonce}`; a new Safe is a new
      salt, deployed on first use. At signing time the connected owner account must match that Safe's owner;
      otherwise ask the wallet to switch accounts.

## Milestones (design doc)

- [ ] M3 Batching: `wallet_sendCalls` / `wallet_getCallsStatus` (EIP-5792); approve + swap as one UserOp.
- [ ] M4 Guard: simulation diff before signing, on-chain postconditions in the same batch, typed-data warnings
      (Permit2, approvals).

## Open checks

- [ ] `test/app-e2e.js` is blocked: the Reown project no longer allows the origin `selfsafe.localhost` (the relay
      closes with `3000 Unauthorized: origin not allowed`; plain `localhost` works). Add it in the Reown dashboard.
      After that, the e2e's USDT-gas step on Base will hit the readable AA50 error: its test Safe holds no USDT.
      The app also shows "ready" while the relay refuses it; surface fatal relay errors.
- [ ] Mainnet USDT gas for real, two small ops. The `approve(0)` reset under a leftover allowance is verified in
      simulation (`test/usdt-gas.live.ts`); the paymaster's validation and postOp with USDT are not.
- [ ] Decoding beyond ERC-20 approve/transfer (known routers, Permit2).
- [ ] hash-pin: service worker verification is designed but untested.
