# Deploying SelfSafe

SelfSafe is a static site: one `index.html`, one script, one stylesheet. It has no backend and holds no keys.
Browsers pin it with [hash-pin](../../hash-pin), so after pinning the host can only make it fail to load,
not change what runs. What you deploy is therefore a *release*: its pin value is what users check.

## What you need

- A domain with HTTPS. hash-pin accepts `http://` only for `localhost`.
- A Reown project ID (cloud.reown.com). Add the production domain to the project's **allowed domains**:
  the relay checks the page's origin. Reown sees that origin, your users' IPs and the project ID; dapps do not.
- Podman 4.4 or newer on the host (Quadlet).

## 1. Build the image

On any machine with the source at a release tag:

```sh
podman build -f deploy/Containerfile --build-arg PROJECT_ID=<project id> -t localhost/selfsafe:<version> .
```

The build log prints the **pin value**, e.g. `pin value sha256-x4qH…`. Publish it with the release.
The same tag, lockfile and project ID always produce the same pin value; anyone can rebuild and compare:

```sh
podman run --rm --entrypoint sh localhost/selfsafe:<version> -c 'sha256sum /srv/index.html | cut -d" " -f1 | xxd -r -p | base64'
```

(or `pnpm install --frozen-lockfile && PROJECT_ID=<id> pnpm build` outside a container.)

## 2. Get the image onto the host

Either build on the host, or copy it:

```sh
podman save localhost/selfsafe:<version> | ssh <host> podman load
```

## 3. Install the Quadlet unit

Rootless (recommended), as the user that will run it:

```sh
mkdir -p ~/.config/containers/systemd
cp deploy/selfsafe.container ~/.config/containers/systemd/
# edit Image= to the tag you built
systemctl --user daemon-reload
systemctl --user start selfsafe
loginctl enable-linger "$USER"   # keep it running without a login session
```

Rootful: put the file in `/etc/containers/systemd/` and use `systemctl` without `--user`.

The unit runs the container read-only with every capability dropped except `NET_BIND_SERVICE` (the caddy
binary carries that file capability and will not start without it). There is no auto-update on purpose: a new
image means a new pin value, and every user has to approve it.

## 4. HTTPS

**A) Behind your reverse proxy (default).** The container listens on `127.0.0.1:8080`. Proxy the domain to it.
The proxy must pass bytes through unchanged:

- no HTML rewriting or injection (CDN "optimizations", analytics snippets, email obfuscation, Cloudflare
  Rocket Loader): any change to `index.html` or `app.js` breaks every user's pin;
- compression is fine only if the proxy honours `Accept-Encoding: identity`, which hash-pin sends (Caddy and
  nginx do).

Caddy example:

```caddy
selfsafe.example.org {
	reverse_proxy 127.0.0.1:8080
}
```

**B) Caddy in the container terminates TLS.** In the unit, comment out block A and uncomment block B: set
`SITE_ADDRESS` to the domain, publish 80 and 443, keep the `/data` volume for certificates. Rootless Podman
cannot bind ports below 1024 on the host unless `net.ipv4.ip_unprivileged_port_start` allows it.

The server sends the same Content-Security-Policy that hash-pin enforces, so the app behaves the same before
and after pinning.

## 5. Check it

```sh
curl -sI https://selfsafe.example.org/ | grep -i content-security-policy
curl -s https://selfsafe.example.org/ | openssl dgst -sha256 -binary | base64   # must equal the pin value
```

## For users

1. Install hash-pin in Firefox (`about:debugging` → Load Temporary Add-on → `hash-pin/extension/manifest.json`).
2. Open the site, click the hash-pin toolbar button, **Check this site for pinning**, compare the pin value with
   the published one, **Pin**.
3. **Connect** the wallet that owns the Safe (Ambire works; wallets that inject inline scripts, like Enkrypt,
   are blocked by the pinned page's CSP).
4. In a dapp choose WalletConnect, copy its link, paste it into SelfSafe, **Pair**, **Approve**.

## Updating

Build and deploy the new tag, publish its pin value. Users' next visit is blocked by hash-pin, which shows
which files changed; they compare the new pin value and **Re-pin**. Settings and WalletConnect sessions
survive, because the origin stays the same.
