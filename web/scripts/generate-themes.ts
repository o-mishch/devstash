/**
 * Theme generator for the web/ SPA.
 *
 * Reads the tweakcn preset source (web/src/lib/themes/presets-raw.json — a deliberate
 * per-stack copy of the legacy src/ source, per .agents/rules/boundary.md: duplicate
 * shared data across the boundary rather than importing across it) and emits:
 *
 *   - web/src/styles/themes.generated.css  — `:root` (light default) + `.dark` +
 *     one `[data-theme="<slug>"]` light block and `.dark[data-theme="<slug>"]` dark
 *     block per preset. The runtime `--background`/`--primary`/… vars these define are
 *     mapped to Tailwind utilities by the `@theme` block in app.css.
 *   - web/src/lib/theme-presets.generated.ts — the `APP_THEMES` union + `APP_THEME_OPTIONS`
 *     metadata (label/description + light/dark swatch) the settings theme grid renders.
 *
 * Regenerate with `npm run themes:gen`. Both outputs are generated — never hand-edit them.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

interface ThemeTokens {
  background: string
  primary: string
  radius?: string
  [token: string]: string | undefined
}

interface RawPreset {
  slug: string
  name: string
  description: string
  light: ThemeTokens
  dark: ThemeTokens
}

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '..')

const SLUG_PATTERN = /^[a-z0-9-]+$/

function isTokensWithRequiredKeys(value: unknown): value is ThemeTokens {
  if (typeof value !== 'object' || value === null) return false
  const tokens = value as Record<string, unknown>
  return typeof tokens['background'] === 'string' && typeof tokens['primary'] === 'string'
}

function validatePreset(value: unknown, index: number): RawPreset {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`presets-raw.json[${index}]: not an object`)
  }
  const p = value as Record<string, unknown>
  const label = typeof p['slug'] === 'string' ? p['slug'] : `#${index}`

  for (const field of ['slug', 'name', 'description'] as const) {
    if (typeof p[field] !== 'string') {
      throw new Error(`presets-raw.json preset "${label}": missing/invalid required field "${field}"`)
    }
  }
  if (!SLUG_PATTERN.test(p['slug'] as string)) {
    throw new Error(
      `presets-raw.json preset "${label}": slug "${p['slug'] as string}" must match ${SLUG_PATTERN}`,
    )
  }
  if (!isTokensWithRequiredKeys(p['light'])) {
    throw new Error(`presets-raw.json preset "${label}": "light" is missing required keys "background"/"primary"`)
  }
  if (!isTokensWithRequiredKeys(p['dark'])) {
    throw new Error(`presets-raw.json preset "${label}": "dark" is missing required keys "background"/"primary"`)
  }
  // Build the result from the fields validated just above rather than double-casting the whole
  // record: each single assertion is honest because the check on that field precedes it (the
  // string fields by the loop, light/dark by isTokensWithRequiredKeys).
  return {
    slug: p['slug'] as string,
    name: p['name'] as string,
    description: p['description'] as string,
    light: p['light'] as ThemeTokens,
    dark: p['dark'] as ThemeTokens,
  }
}

const parsedPresets = JSON.parse(
  fs.readFileSync(path.join(webRoot, 'src/lib/themes/presets-raw.json'), 'utf8'),
) as unknown

if (!Array.isArray(parsedPresets)) {
  throw new Error('presets-raw.json: expected a top-level array of presets')
}

const rawPresets = parsedPresets.map((p, i) => validatePreset(p, i))

// A slug's own escaping isn't needed (slugs are `[a-z0-9-]`), but the label/description are
// free text that lands inside single-quoted TS string literals — escape backslashes/quotes.
function tsString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function tokenBlock(tokens: ThemeTokens): string {
  return Object.entries(tokens)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `  --${key}: ${value};\n`)
    .join('')
}

// ---- CSS ----------------------------------------------------------------------------------
const GENERATED_BANNER = `/* ============================================================
 *  GENERATED THEME PRESETS CSS — do not edit by hand.
 *  Source: web/src/lib/themes/presets-raw.json  ·  Regenerate: npm run themes:gen
 * ============================================================ */\n\n`

const modernMinimal = rawPresets.find((p) => p.slug === 'modern-minimal')
if (!modernMinimal) {
  throw new Error('presets-raw.json is missing the required baseline preset "modern-minimal"')
}

let css = GENERATED_BANNER
// Baseline in :root (light) + .dark (dark) so the app renders correctly before any
// [data-theme] is applied. Dark is the product default; the no-flash script adds the
// `dark` class to <html> pre-hydration.
css += `:root {\n${tokenBlock(modernMinimal.light)}}\n\n`
css += `.dark {\n${tokenBlock(modernMinimal.dark)}}\n\n`

for (const preset of rawPresets) {
  css += `/* ${preset.name} */\n`
  css += `[data-theme='${preset.slug}'] {\n  color-scheme: light;\n${tokenBlock(preset.light)}}\n\n`
  css += `.dark[data-theme='${preset.slug}'],\n.dark [data-theme='${preset.slug}'] {\n  color-scheme: dark;\n${tokenBlock(preset.dark)}}\n\n`
}

const cssOut = path.join(webRoot, 'src/styles/themes.generated.css')
fs.writeFileSync(cssOut, css, 'utf8')

// ---- TypeScript registry ------------------------------------------------------------------
let ts = `/**
 * GENERATED THEME PRESETS — do not edit by hand.
 * Source: web/src/lib/themes/presets-raw.json  ·  Regenerate: npm run themes:gen
 */

export const APP_THEMES = [
${rawPresets.map((p) => `  '${p.slug}',`).join('\n')}
] as const

export type AppTheme = (typeof APP_THEMES)[number]

export interface ThemePresetOption {
  value: AppTheme
  label: string
  description: string
  light: { bg: string; primary: string }
  dark: { bg: string; primary: string }
}

export const APP_THEME_OPTIONS: ThemePresetOption[] = [
${rawPresets
  .map(
    (p) =>
      `  {\n    value: '${p.slug}',\n    label: '${tsString(p.name)}',\n    description: '${tsString(p.description)}',\n    light: { bg: '${tsString(p.light.background)}', primary: '${tsString(p.light.primary)}' },\n    dark: { bg: '${tsString(p.dark.background)}', primary: '${tsString(p.dark.primary)}' },\n  },`,
  )
  .join('\n')}
]
`

const tsOut = path.join(webRoot, 'src/lib/theme-presets.generated.ts')
fs.writeFileSync(tsOut, ts, 'utf8')

console.log(`Generated ${path.relative(webRoot, cssOut)} and ${path.relative(webRoot, tsOut)} from ${rawPresets.length} presets`)
