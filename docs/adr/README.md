# Architecture decision records

Format: Status, Context, Decision, Consequences. New decisions get the next number; superseded ones stay, marked `Superseded by NNNN`.

| # | Decision | Status |
| --- | --- | --- |
| 0001 | [Owner-signed 1-of-1 Safe with the ERC-4337 module](0001-owner-signed-safe-with-4337-module.md) | Accepted |
| 0002 | [Gas: Pimlico ERC-20 paymaster or the Safe's own ETH](0002-gas-payment.md) | Accepted |
| 0003 | [Backendless static web app proxying dapps over WalletConnect](0003-backendless-static-proxy.md) | Accepted |
| 0004 | [Code delivery: plain static site pinned with hash-pin](0004-code-delivery-hash-pin.md) | Accepted |
| 0005 | [Neutral WalletConnect metadata, reinstalled after init](0005-neutral-walletconnect-metadata.md) | Accepted |
| 0006 | [Public RPCs: publicnode defaults, batching, tolerant polling](0006-rpc-and-bundler-resilience.md) | Accepted |
| 0007 | [Build: one SRI-covered bundle, reproducible, no eval/inline/wasm](0007-build-constraints.md) | Accepted |
| 0008 | [Deployment: Caddy container run by a Quadlet unit](0008-deployment-container-quadlet.md) | Accepted |
| 0009 | [One running instance serving multiple Safes](0009-single-instance-multiple-safes.md) | Proposed |
| 0010 | [Activity log: chain events plus a local journal](0010-activity-log.md) | Proposed |
| 0011 | [Configurable chains with runtime capability checks](0011-configurable-chains.md) | Proposed |
