# 0008. Deployment: Caddy container run by a Quadlet unit

- Status: Accepted
- Date: 2026-09-26

## Context

The target is a remote host running Podman. The site is static; TLS is either the host's reverse proxy or Caddy.

## Decision

Two-stage image (Node build with the pinned lockfile, then `caddy:2-alpine` serving `/srv`), Caddyfile sending the
same CSP as hash-pin and never compressing, Quadlet unit running it read-only with all capabilities dropped except
`NET_BIND_SERVICE` (the caddy binary's file capability requires it). No auto-update.

## Consequences

- Every release is deliberate and has a published pin value; users re-pin.
- Proxies must not rewrite HTML (CDN optimizations would break every pin).
- See `docs/DEPLOY.md`.
