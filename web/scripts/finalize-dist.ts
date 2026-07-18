// Post-build CSP generator for the static output. Runs AFTER `vite build` (so Start's
// prerender has already emitted index.html + _shell.html), the one thing that can only happen
// once every HTML file exists on disk:
//
//   Strict hash-based CSP → firebase.json. A build-time nonce is worthless on a static CDN
//   and TanStack Start's inline hydration script embeds per-build asset hashes + a timestamp,
//   so its hash changes every build → the policy must be regenerated per build. Delivered as
//   an HTTP RESPONSE HEADER (OWASP-preferred; a <meta> CSP can't carry `frame-ancestors` or
//   the `report-to` reporting directive). firebase.json is GENERATED (gitignored) from
//   firebase.template.json so per-build hashes never churn a tracked file — edit hosting
//   config in the TEMPLATE.
//
// (The `_shell.html` noindex <meta> is emitted by the router itself — src/routes/__root.tsx
// renders it when `isShell()` is true — so it no longer needs a post-build injection here.)
//
// The heavy lifting is delegated to libraries: node-html-parser enumerates scripts (and
// correctly skips non-executable `type="application/ld+json"` data blocks, which CSP's
// script-src does not govern) and csp-header assembles the policy string. File discovery uses
// Node's built-in fs.globSync (no glob dependency).
//
// Run via `tsx` (like scripts/gen-og-image.tsx). This security control IS type-checked: it is
// excluded from the app-scoped `typecheck` gate + oxlint, but `tsconfig.scripts.json` covers it
// and `npm run build` runs `tsc -p tsconfig.scripts.json` before executing the script.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, globSync } from 'node:fs'
import { parse, type HTMLElement } from 'node-html-parser'
import { getCSP, SELF, NONE, INLINE } from 'csp-header'
import { loadEnv } from 'vite'

const DIST = 'dist/client'
const TEMPLATE = 'firebase.template.json'
const OUTPUT = 'firebase.json'

// The API origin the bundle actually calls (must match src/lib/api/config.ts's
// VITE_API_BASE_URL override) so connect-src / report-to don't block a non-default build.
// Resolved via Vite's loadEnv so it reads the SAME source as the bundle's import.meta.env:
// .env files AND exported process.env vars. Reading process.env alone would miss a .env-file
// origin and ship a CSP that blocks the API.
//
// MODE must match the `vite build --mode` that produced dist/, or the CSP is built from a
// different .env than the bundle (e.g. --mode staging bundles .env.staging while a hardcoded
// 'production' here would read .env.production → connect-src blocks every API call). `npm run
// build` passes neither, so both sides default to 'production'; a non-default build must set
// BUILD_MODE to the same value it passes to `vite build --mode`.
const MODE = process.env['BUILD_MODE'] ?? 'production'
const env = loadEnv(MODE, process.cwd(), 'VITE_')
const API_ORIGIN = ((): string => {
  const raw = env['VITE_API_BASE_URL']
  if (!raw) return 'https://api.devstash.one'
  try {
    return new URL(raw).origin
  } catch {
    return 'https://api.devstash.one'
  }
})()

// Reports go to the Go API: Firebase is static and can't receive the POSTs. Cross-origin
// (beta. → api.), which the API's CORS/CSRF layer already trusts.
const REPORT_GROUP = 'csp-endpoint'
const REPORT_ENDPOINT = `${API_ORIGIN}/csp-report`

// Shape of the subset of firebase.json we read/mutate (see firebase.template.json).
interface FirebaseHeaderEntry {
  key: string
  value: string
}
interface FirebaseHeaderBlock {
  source: string
  headers: FirebaseHeaderEntry[]
}
interface FirebaseConfig {
  hosting?: { headers?: FirebaseHeaderBlock[] }
}

// A <script> is executable JS (and thus needs a script-src hash) when it has no `src` and
// either no `type` or a JavaScript MIME "essence" string. Matching is EXACT on the essence
// (type/subtype with parameters stripped), per the HTML spec's "prepare the script element"
// algorithm — a parameterised `text/javascript;charset=utf-8` is not an essence match and
// browsers do NOT execute it, so it must not be hashed either.
const EXECUTABLE_TYPES = new Set([
  'module',
  'text/javascript',
  'application/javascript',
  'text/ecmascript',
  'application/ecmascript',
  // Legacy essence strings. All still execute per the spec, so all still need hashing.
  'application/x-javascript',
  'application/x-ecmascript',
  'text/x-javascript',
  'text/x-ecmascript',
  'text/jscript',
  'text/livescript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
])

// Inert data blocks: never executed, and script-src does not govern them → no hash needed.
// NOTE `importmap` / `speculationrules` are deliberately ABSENT — they are not classic
// executables but ARE script-src-governed, so they must fail closed below rather than be
// silently skipped.
const INERT_DATA_TYPES = new Set(['application/json', 'application/ld+json'])

/** How CSP treats an inline <script>, decided by its `type` attribute. */
type InlineScriptKind = 'executable' | 'inert-data' | 'unrecognized'

function inlineScriptKind(script: HTMLElement): InlineScriptKind {
  // Absent or empty type ⇒ classic JS. Trim + lowercase: the browser strips ASCII whitespace
  // around the type and matches case-insensitively, so a padded `type=" module "` executes.
  const type = script.getAttribute('type')?.trim().toLowerCase()
  if (!type) return 'executable'
  if (EXECUTABLE_TYPES.has(type)) return 'executable'
  if (INERT_DATA_TYPES.has(type)) return 'inert-data'
  return 'unrecognized'
}

function sha256(body: string): string {
  return `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`
}

/**
 * sha256 hashes of every executable inline <script> in ONE HTML file. Fails closed on both an
 * unrecognized script type and a file that yields no hashes at all.
 */
function hashesInFile(file: string): string[] {
  // Parser defaults are deliberate: they already treat <script> as a block-text element AND
  // keep <style>/<pre>/<noscript> opaque. Passing `blockTextElements` here would SHALLOW-MERGE
  // (replacing those defaults), making the parser descend into <style>/<pre> and mint phantom
  // "scripts" from a CSS `content:` string or the marketing page's <pre> code block — i.e. a
  // bogus hash in the production CSP.
  const root = parse(readFileSync(file, 'utf8'))
  const inline = root
    .querySelectorAll('script')
    .filter((script) => script.getAttribute('src') === undefined)

  // node-html-parser is lenient — it never throws on malformed HTML, it just returns fewer
  // matches. So every ambiguity has to fail the build rather than quietly shrink the policy.
  const unrecognized = inline.filter((script) => inlineScriptKind(script) === 'unrecognized')
  if (unrecognized.length > 0) {
    const types = unrecognized.map((script) => script.getAttribute('type')).join(', ')
    console.error(
      `[finalize-dist] ${file}: inline <script> with unrecognized type(s): ${types} — if executable or otherwise script-src-governed (e.g. importmap, speculationrules) it must be hashed; if it is inert data, add it to INERT_DATA_TYPES`,
    )
    process.exit(1)
  }

  const hashes = inline
    .filter((script) => inlineScriptKind(script) === 'executable' && script.rawText.trim() !== '')
    .map((script) => sha256(script.rawText))

  // Every page Start emits carries its inline bootstrap, so "≥1 inline-script hash per HTML
  // file" is an exact invariant. Asserting per file (not just on the union) stops one page's
  // hashes from masking another's parse failure — which would ship a CSP that blocks the
  // unparsed page's hydration while the build still reported success.
  if (hashes.length === 0) {
    console.error(
      `[finalize-dist] ${file}: no executable inline scripts found — parse failure or unexpected build output; refusing to ship a CSP that would block this page`,
    )
    process.exit(1)
  }
  return hashes
}

/** Union of sha256 hashes of every executable inline <script> across all HTML files. */
function collectInlineScriptHashes(files: string[]): string[] {
  return [...new Set(files.flatMap((file) => hashesInFile(file)))]
}

function buildPolicy(scriptHashes: string[]): string {
  return getCSP({
    directives: {
      'default-src': [SELF],
      'script-src': [SELF, ...scriptHashes],
      // 'unsafe-inline' is required by Sonner: it injects its stylesheet at RUNTIME via
      // document.createElement('style') (see the Toaster in src/router.tsx), so there is no
      // build-time text to hash the way script-src hashes its inline scripts. Nothing else
      // needs it — the app's own styling is a linked Tailwind stylesheet, and it ships zero
      // inline style attributes. Do not tighten this to SELF without first dropping Sonner
      // or pinning its <style> to a nonce: every toast would silently lose its styling.
      'style-src': [SELF, INLINE],
      'img-src': [SELF, 'data:'],
      'font-src': [SELF],
      'connect-src': [SELF, API_ORIGIN],
      'object-src': [NONE],
      'base-uri': [NONE],
      'form-action': [SELF],
      // Header delivery lets us enforce framing in-policy (a <meta> CSP could not);
      // X-Frame-Options in the template stays as the pre-CSP-Level-2 fallback.
      'frame-ancestors': [NONE],
      // Enforced policy + telemetry. Reporting-Endpoints (below) names the group's URL.
      'report-to': REPORT_GROUP,
      // Legacy fallback: Firefox (and other non-Reporting-API UAs) only honor report-uri
      // for CSP violations, so without this their reports would be silently dropped.
      'report-uri': REPORT_ENDPOINT,
    },
  }).replace(/;\s*$/, '') // drop csp-header's trailing "; "
}

// --- CSP header → firebase.json ---------------------------------------------------------
const files = globSync(`${DIST}/**/*.html`)
if (files.length === 0) {
  console.error(`[finalize-dist] no HTML files found under ${DIST}`)
  process.exit(1)
}

// The prerendered marketing homepage is the ONLY SEO route, and its emission rides on
// RC-grade Start internals: SPA mode pushes a shell page at `spa.maskPath`, which — if it
// ever collides with the `/` content page again — loses `/` in the path-keyed prerender
// dedup, leaving only _shell.html. That regression is otherwise silent: the build succeeds
// and Firebase just serves an empty shell to crawlers.
if (!files.some((file) => file.endsWith('/index.html'))) {
  console.error(
    `[finalize-dist] ${DIST}/index.html missing — Start's '/' prerender did not emit (maskPath collision?)`,
  )
  process.exit(1)
}

const hashes = collectInlineScriptHashes(files)
if (hashes.length === 0) {
  console.error(
    '[finalize-dist] no inline-script hashes found — refusing to ship a CSP that would block Start’s inline scripts',
  )
  process.exit(1)
}

let config: FirebaseConfig
try {
  config = JSON.parse(readFileSync(TEMPLATE, 'utf8')) as FirebaseConfig
} catch (err) {
  console.error(
    `[finalize-dist] failed to parse ${TEMPLATE}: ${err instanceof Error ? err.message : String(err)}`,
  )
  process.exit(1)
}
const globalBlock = config.hosting?.headers?.find((block) => block.source === '**')
if (!globalBlock) {
  console.error(`[finalize-dist] ${TEMPLATE} has no "**" header block to attach the CSP to`)
  process.exit(1)
}

// The CSP + reporting endpoint apply to every route, including the SPA-rewrite paths (Firebase
// matches header globs against the REQUEST path, not the served file), so they go on the
// global "**" block alongside the other security headers. Drop any pre-existing entries first
// so a template that ever declares these can't ship duplicate (browser-intersected) headers.
globalBlock.headers = globalBlock.headers.filter(
  (h) => h.key !== 'Content-Security-Policy' && h.key !== 'Reporting-Endpoints',
)
globalBlock.headers.push(
  { key: 'Content-Security-Policy', value: buildPolicy(hashes) },
  { key: 'Reporting-Endpoints', value: `${REPORT_GROUP}="${REPORT_ENDPOINT}"` },
)

writeFileSync(OUTPUT, `${JSON.stringify(config, null, 2)}\n`)
console.log(
  `[finalize-dist] ${OUTPUT} CSP header with ${hashes.length} inline-script hash(es), report-to ${REPORT_ENDPOINT}`,
)
