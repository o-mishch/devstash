import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import sitemap from 'vite-plugin-sitemap'
import svgr from 'vite-plugin-svgr'

// Static output lives in dist/client (TanStack Start SPA mode), not Vite's default dist/.
const CLIENT_OUT = 'dist/client'

// Only `/` is indexable content; everything else is the client-rendered app/auth shell.
// Disallowed in robots.txt to save crawl budget (these are not real files, so the sitemap
// plugin never discovers them — this is purely the robots policy).
const DISALLOW = [
  '/dashboard',
  '/items',
  '/collections',
  '/favorites',
  '/sign-in',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/link-account',
  '/profile',
  '/settings',
  '/upgrade',
  '/shell',
]

// (The SPA shell's noindex <meta> is emitted by the router itself: src/routes/__root.tsx
// renders `<meta name="robots" content="noindex">` when `isShell()` is true, which Start sets
// only while prerendering _shell.html — so the shell is noindexed but the prerendered `/`
// stays indexable.)

// DevStash web frontend. In production: TanStack Start SPA mode — static build,
// no server runtime, deployed to Firebase Hosting. The app talks ONLY to the Go
// API on Cloud Run.
// In development: SPA mode is disabled so TanStack Start runs its built-in SSR
// dev server, which renders full HTML+CSS on every request — no black screen or
// spinner before the first paint.
export default defineConfig(({ mode }) => {
  // Resolve VITE_* origins the same way the bundle does: loadEnv merges .env files AND
  // exported process.env vars (VITE_-prefixed), exactly what import.meta.env sees. Reading
  // process.env alone would miss .env-file values, so the prerendered site origin here (and
  // the CSP connect-src in finalize-dist) could diverge from the origin the bundle calls.
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // Canonical site origin (canonical/og:url/sitemap). `|| fallback` coerces a defined-but-empty
  // VITE_SITE_URL="" (blank CI substitution) to the default, matching src/lib/site-config.ts —
  // `?? fallback` alone would pass "" to new URL and throw at config-eval time.
  const SITE_ORIGIN = new URL(env['VITE_SITE_URL'] || 'https://beta.devstash.one').origin

  return {
    server: {
      port: 3000,
      // Dev is same-origin: /api/* is proxied to the local Go server (no CORS locally).
      // Prod hits https://api.devstash.one directly — see src/lib/api/config.ts.
      proxy: {
        '/api': {
          target: 'http://localhost:8080',
          changeOrigin: true,
          rewrite: (path): string => path.replace(/^\/api/, ''),
        },
      },
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // A build-time nonce is worthless on a static CDN, so the whole CSP is hash-based.
    // vite-plugin-csp-guard can't run under Start's build, so the policy is built post-build by
    // scripts/finalize-dist.ts (wired into the `build` npm script): it sha256-hashes every
    // executable inline <script> across the emitted HTML and writes the CSP as an HTTP header
    // into a generated firebase.json (from firebase.template.json) — header, not <meta>, so it
    // can carry frame-ancestors and report-to. Modulepreload polyfill is disabled below so no
    // extra inline script sneaks in.
    build: {
      modulePreload: { polyfill: false },
    },
    plugins: [
      tanstackStart({
        // SPA mode is on for every real build — production AND custom build modes like
        // `--mode staging` (which finalize-dist explicitly supports) — and off only for the
        // dev SSR server. It emits a `_shell.html` (keyed to maskPath `/shell` so it doesn't
        // collide with the prerendered `/index.html`) that Firebase Hosting serves as the
        // fallback for every non-static route — the target of finalize-dist's `**→_shell`
        // rewrite, which a staging build must also produce. In dev, omitting spa makes
        // TanStack Start run its SSR dev server instead, so `localhost:3000/` responds with
        // fully-rendered HTML+CSS immediately.
        ...(mode === 'development' ? {} : { spa: { enabled: true, maskPath: '/shell' } }),
        // Statically prerender the marketing homepage so crawlers (and JS-disabled
        // visitors) get real content; Firebase serves this /index.html for `/` ahead
        // of the `**→_shell` rewrite. Only active during `npm run build`.
        pages: [
          {
            path: '/',
            // crawlLinks:false — prerender ONLY `/`, don't follow links into the auth
            // pages (whose beforeLoad would fetch the session at build time). Everything
            // else is client-rendered from the shell.
            prerender: { enabled: true, outputPath: '/index.html', crawlLinks: false },
          },
        ],
      }),
      // robots.txt + sitemap.xml (replaces the old scripts/gen-seo-files.mjs). Writes into
      // dist/client (Start's output, not Vite's default dist/) at closeBundle. dynamicRoutes
      // guarantees `/` is in the sitemap regardless of when Start's prerender emits
      // index.html; `/` is the only indexable URL. exclude drops the discovered shell route.
      sitemap({
        hostname: SITE_ORIGIN,
        outDir: CLIENT_OUT,
        dynamicRoutes: ['/'],
        exclude: ['/shell', '/_shell'],
        changefreq: 'weekly',
        priority: 1,
        readable: true,
        robots: [{ userAgent: '*', allow: '/', disallow: DISALLOW }],
      }),
      // react's vite plugin must come AFTER start's vite plugin.
      viteReact(),
      // React Compiler (1.0) auto-memoizes app components/hooks — fewer manual
      // useMemo/useCallback. In plugin-react 6 it's a separate rolldown babel pass via
      // reactCompilerPreset (no `target` needed for React 19). Scoped to app source —
      // `.ts` too, so hooks authored outside `.tsx` (e.g. src/hooks/*.ts) get compiled.
      babel({
        include: /src\/.*\.[jt]sx?$/,
        exclude: /node_modules/,
        presets: [reactCompilerPreset()],
      }),
      tailwindcss(),
      // `?react` imports turn an .svg file into a typed React component (see src/vite-env.d.ts).
      svgr(),
    ],
  }
})
