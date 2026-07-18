/** @jsxRuntime automatic */
/** @jsxImportSource react */
// Build-time generator for the Open Graph / Twitter social card (public/og-image.png).
//
// The @jsx* pragmas above force esbuild (via tsx) to use React's automatic JSX runtime for
// this file — it lives outside tsconfig's `include: ["src"]`, so the project-wide
// `jsx: react-jsx` setting isn't applied to it and esbuild would otherwise emit classic
// `React.createElement` calls (and crash with "React is not defined").
//
// The card is authored IN CODE as a normal JSX component tree — Satori renders it to SVG,
// resvg rasterizes it to PNG — so the repo carries no committed image binary.
// public/og-image.png is generated + gitignored, the same pattern as firebase.json and the
// SEO files. Social crawlers (Slack / Twitter / LinkedIn / Facebook) require a real,
// absolutely-hosted raster for og:image and render neither SVG nor data-URIs there, so this
// MUST emit a PNG.
//
// Runs FIRST in `npm run build` (via `tsx`, which compiles this JSX), before `vite build`,
// because Vite copies public/ into dist/client — the PNG has to exist by then. Colors are hex
// mirrors of the live "modern-minimal" dark tokens in src/styles/app.css (Satori has no oklch
// support) — blue primary, matching the site + favicon.
//
// FONTS: the card is set in Inter/JetBrains Mono while the SITE ships Geist — a deliberate
// substitution, not an oversight. Satori requires a STATIC font buffer and accepts .woff but
// not .woff2; @fontsource-variable/geist ships variable .woff2 ONLY, and no static Geist
// @fontsource package exists. The @fontsource/inter + @fontsource/jetbrains-mono devDeps are
// the closest available static .woff faces. Switching this to Geist crashes the build unless a
// static Geist .woff appears upstream first.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'

const OUT = join('public', 'og-image.png')
const WIDTH = 1200
const HEIGHT = 630

// "Modern-minimal" dark palette — hex mirrors of the oklch tokens in src/styles/app.css,
// converted oklch→sRGB (Satori has no oklch). Every neutral there is chroma-0 pure gray, so
// these carry NO blue tint; only ACCENT (the blue --primary) is chromatic.
const BG = '#161616' /* --background     oklch(0.2 0 0) */
const FG = '#e4e4e4' /* --foreground     oklch(0.92 0 0) */
const MUTED = '#a4a4a4' /* --muted-foreground oklch(0.72 0 0) */
const ACCENT = '#3981f6' /* --primary        oklch(0.62 0.19 259.81) */
const BORDER = '#404040' /* --border         oklch(0.37 0 0) */
const CARD = '#262626' /* --card           oklch(0.27 0 0) */

const font = (file: string) => readFileSync(join('node_modules/@fontsource', file))
const fonts = [
  {
    name: 'Inter',
    weight: 400 as const,
    style: 'normal' as const,
    data: font('inter/files/inter-latin-400-normal.woff'),
  },
  {
    name: 'Inter',
    weight: 800 as const,
    style: 'normal' as const,
    data: font('inter/files/inter-latin-800-normal.woff'),
  },
  {
    name: 'JetBrains Mono',
    weight: 500 as const,
    style: 'normal' as const,
    data: font('jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff'),
  },
]

// The favicon mark, reproduced: rounded square, blue `›` glyph.
const Mark = (
  <div
    style={{
      display: 'flex',
      width: 96,
      height: 96,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 22,
      background: CARD,
      border: `2px solid ${BORDER}`,
      color: ACCENT,
      fontFamily: 'JetBrains Mono',
      fontWeight: 500,
      fontSize: 64,
    }}
  >
    ›
  </div>
)

const Card = (
  <div
    style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      width: WIDTH,
      height: HEIGHT,
      padding: '72px 80px',
      color: FG,
      fontFamily: 'Inter',
      backgroundColor: BG,
      // Faint blue glow bleeding from the top-left corner — ACCENT at 12% alpha.
      backgroundImage:
        'radial-gradient(900px 520px at 12% -8%, rgba(57,129,246,0.12), transparent 62%)',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 26 }}>
      {Mark}
      <div
        style={{
          display: 'flex',
          fontFamily: 'Inter',
          fontWeight: 800,
          fontSize: 52,
          color: FG,
          letterSpacing: '-0.02em',
        }}
      >
        DevStash
      </div>
    </div>

    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'Inter',
          fontWeight: 800,
          fontSize: 88,
          lineHeight: 1.04,
          letterSpacing: '-0.03em',
          color: FG,
        }}
      >
        <div style={{ display: 'flex' }}>Your developer</div>
        <div style={{ display: 'flex' }}>
          <span style={{ color: ACCENT }}>knowledge</span>
          {/* U+00A0 (non-breaking space): Satori collapses a regular leading space on a
              flex-item text node, so a plain " hub" would render as "knowledgehub". */}
          <span>{'\u00A0hub'}</span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          maxWidth: 940,
          fontFamily: 'Inter',
          fontWeight: 400,
          fontSize: 30,
          lineHeight: 1.4,
          color: MUTED,
        }}
      >
        One fast, searchable place for snippets, prompts, commands, notes, files, images &amp;
        links.
      </div>
    </div>

    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        fontFamily: 'JetBrains Mono',
        fontWeight: 500,
        fontSize: 24,
        color: MUTED,
      }}
    >
      <span style={{ color: ACCENT }}>›</span>
      <span>snippet · prompt · command · note · file · image · link</span>
    </div>
  </div>
)

const svg = await satori(Card, { width: WIDTH, height: HEIGHT, fonts })
const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng()

try {
  mkdirSync('public', { recursive: true })
  writeFileSync(OUT, png)
} catch (err) {
  console.error(
    `[gen-og] failed to write ${OUT}: ${err instanceof Error ? err.message : String(err)}`,
  )
  process.exit(1)
}
console.log(`[gen-og] wrote ${OUT} (${WIDTH}×${HEIGHT}, ${png.length} bytes)`)
