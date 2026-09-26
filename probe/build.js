// Bundles src/probe.js into one SRI-covered script: dist/{index.html,app.js}.
import { build } from "esbuild"
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"

const dist = new URL("dist/", import.meta.url)
mkdirSync(dist, { recursive: true })
await build({
    entryPoints: [new URL("src/probe.js", import.meta.url).pathname],
    outfile: new URL("app.js", dist).pathname,
    bundle: true, format: "esm", platform: "browser", target: "es2022",
    define: { global: "globalThis", "process.env.NODE_ENV": '"production"', __PROJECT_ID__: JSON.stringify(readFileSync(new URL("../.projectid", import.meta.url), "utf8").trim()) },
    logLevel: "warning",
})
const app = readFileSync(new URL("app.js", dist))
const index = readFileSync(new URL("src/index.html", import.meta.url), "utf8")
    .replace("{{app.js}}", `sha384-${createHash("sha384").update(app).digest("base64")}`)
writeFileSync(new URL("index.html", dist), index)
console.log(`app.js ${(app.length / 1024).toFixed(0)} KiB, pin value sha256-${createHash("sha256").update(index).digest("base64")}`)
