// Builds the static app into dist/app/: one script and one stylesheet, both covered by SRI in index.html,
// so hash-pin can pin it; the icon is inlined as a data: URL, so index.html covers it too. Prints the pin value
// (sha256 of index.html) to publish with the release. The Reown project ID comes from $PROJECT_ID or .projectid.
import { build } from "esbuild"
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

const src = new URL("../src/app/", import.meta.url), dist = new URL("../dist/app/", import.meta.url)
const projectId = (process.env.PROJECT_ID ?? readFileSync(new URL("../.projectid", import.meta.url), "utf8")).trim()
if (!/^[0-9a-f]{32}$/.test(projectId)) throw new Error("PROJECT_ID (or .projectid) must be a 32-hex-digit Reown project ID")
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
await build({
    entryPoints: [new URL("main.ts", src).pathname],
    outfile: new URL("app.js", dist).pathname,
    bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, legalComments: "none",
    define: { global: "globalThis", "process.env.NODE_ENV": '"production"', __PROJECT_ID__: JSON.stringify(projectId) },
    logLevel: "warning",
})
copyFileSync(new URL("style.css", src), new URL("style.css", dist))
const sri = name => `sha384-${createHash("sha384").update(readFileSync(new URL(name, dist))).digest("base64")}`
const icon = `data:image/svg+xml;base64,${readFileSync(new URL("../assets/icon.svg", import.meta.url)).toString("base64")}`
const index = readFileSync(new URL("index.html", src), "utf8").replace("{{app.js}}", sri("app.js")).replace("{{style.css}}", sri("style.css")).replace("{{icon}}", icon)
if (index.includes("{{")) throw new Error("unresolved placeholder in index.html")
writeFileSync(new URL("index.html", dist), index)
const size = readFileSync(new URL("app.js", dist)).length
console.log(`dist/app: app.js ${(size / 1024).toFixed(0)} KiB; pin value sha256-${createHash("sha256").update(index).digest("base64")}`)
