// Builds the static app into dist/app/: one script and one stylesheet, both covered by SRI in index.html,
// so hash-pin can pin it. Prints the pin value (sha256 of index.html) to publish with the release.
import { build } from "esbuild"
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"

const src = new URL("../src/app/", import.meta.url), dist = new URL("../dist/app/", import.meta.url)
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
await build({
    entryPoints: [new URL("main.ts", src).pathname],
    outfile: new URL("app.js", dist).pathname,
    bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true, legalComments: "none",
    define: { global: "globalThis", "process.env.NODE_ENV": '"production"', __PROJECT_ID__: JSON.stringify(readFileSync(new URL("../.projectid", import.meta.url), "utf8").trim()) },
    logLevel: "warning",
})
copyFileSync(new URL("style.css", src), new URL("style.css", dist))
const sri = name => `sha384-${createHash("sha384").update(readFileSync(new URL(name, dist))).digest("base64")}`
const index = readFileSync(new URL("index.html", src), "utf8").replace("{{app.js}}", sri("app.js")).replace("{{style.css}}", sri("style.css"))
if (index.includes("{{")) throw new Error("unresolved placeholder in index.html")
writeFileSync(new URL("index.html", dist), index)
const size = readFileSync(new URL("app.js", dist)).length
console.log(`dist/app: app.js ${(size / 1024).toFixed(0)} KiB; pin value sha256-${createHash("sha256").update(index).digest("base64")}`)
