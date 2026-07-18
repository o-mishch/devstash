/**
 * Fetch tweakcn preset themes into web/src/lib/themes/presets-raw.json — the source the
 * theme generator (scripts/generate-themes.ts, `npm run themes:gen`) reads. A typed per-stack
 * port of the legacy scripts/fetch-theme.js so web/ owns its full theme toolchain rather than
 * reaching across the workspace boundary (.agents/rules/boundary.md).
 *
 * Sources (union, auto-discovered from tweakcn's GitHub):
 *   1. public/r/registry.json — curated list with full cssVars (oklch), no per-theme fetches
 *   2. utils/theme-presets.ts — built-in preset slugs (fetched from the per-theme endpoint)
 * Community slugs absent from both are probed from PROBE_SLUGS (silently skipped on 404).
 *
 * Usage:
 *   npm run themes:fetch -- --replace         rebuild presets-raw.json from all sources
 *   npm run themes:fetch -- --sync            add themes not yet present; keep existing
 *   npm run themes:fetch -- <slug> [slug2…]   fetch specific themes by slug
 *   npm run themes:fetch -- <slug> [--name "Display Name"] [--description "…"] [--after <slug>]
 * Then run `npm run themes:gen` to regenerate the CSS + TS registry.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TWEAKCN_REGISTRY_URL =
  'https://raw.githubusercontent.com/jnsahaj/tweakcn/main/public/r/registry.json'
const TWEAKCN_PRESETS_URL =
  'https://raw.githubusercontent.com/jnsahaj/tweakcn/main/utils/theme-presets.ts'
const REGISTRY_BASE = 'https://tweakcn.com/r/themes'

// Community theme slugs not yet in registry.json or theme-presets.ts. Only add here when a
// theme is on tweakcn.com but absent from both auto-sources; probed, not assumed (404 → skip).
const PROBE_SLUGS = ['notebook', 'darkmatter']

// The subset of cssVars keys tracked in presets-raw.json (mirrors the legacy THEME_KEYS).
const THEME_KEYS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted',
  'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'destructive-foreground',
  'border', 'input', 'ring', 'radius', 'sidebar', 'sidebar-foreground', 'sidebar-primary',
  'sidebar-primary-foreground', 'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border',
  'sidebar-ring',
] as const

type ThemeTokens = Record<string, string>

interface Preset {
  slug: string
  name: string
  description: string
  light: ThemeTokens
  dark: ThemeTokens
}

interface RegistryItem {
  name: string
  title?: string
  description?: string
  cssVars?: { light?: Record<string, string>; dark?: Record<string, string> }
}

interface Args {
  slugs: string[]
  name: string | null
  description: string | null
  after: string | null
  sync: boolean
  replace: boolean
}

const here = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(here, '..')
const rawPresetsPath = path.join(webRoot, 'src/lib/themes/presets-raw.json')

function slugToName(slug: string): string {
  return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function parseArgs(argv: string[]): Args {
  const result: Args = { slugs: [], name: null, description: null, after: null, sync: false, replace: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === undefined) continue
    if (arg === '--sync') result.sync = true
    else if (arg === '--replace') result.replace = true
    else if (arg === '--name') result.name = argv[++i] ?? null
    else if (arg === '--description') result.description = argv[++i] ?? null
    else if (arg === '--after') result.after = argv[++i] ?? null
    else result.slugs.push(arg)
  }
  return result
}

function extractTokens(cssVars: Record<string, string>, slug: string, mode: string): ThemeTokens {
  const tokens: ThemeTokens = {}
  for (const key of THEME_KEYS) {
    const value = cssVars[key]
    if (value !== undefined) tokens[key] = value
    else console.warn(`  [warn] "${slug}" ${mode} mode: missing key "${key}"`)
  }
  if (tokens['background'] === undefined || tokens['primary'] === undefined) {
    throw new Error(
      `"${slug}" ${mode} mode: missing required key(s) "background"/"primary" — malformed preset, refusing to continue`,
    )
  }
  return tokens
}

async function fetchRegistryIndex(): Promise<Preset[]> {
  const res = await fetch(TWEAKCN_REGISTRY_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching registry.json`)
  const data = (await res.json()) as { items: RegistryItem[] }
  return data.items.map((item) => ({
    slug: item.name,
    name: item.title ?? slugToName(item.name),
    description: item.description ?? '',
    light: extractTokens(item.cssVars?.light ?? {}, item.name, 'light'),
    dark: extractTokens(item.cssVars?.dark ?? {}, item.name, 'dark'),
  }))
}

async function fetchBuiltinSlugs(): Promise<string[]> {
  const res = await fetch(TWEAKCN_PRESETS_URL)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching theme-presets.ts`)
  const text = await res.text()
  return text
    .split('\n')
    .map((line) => line.match(/^ {2}"([a-z][a-z0-9-]+)":\s*\{/)?.[1])
    .filter((slug): slug is string => slug !== undefined)
}

const SLUG_PATTERN = /^[a-z][a-z0-9-]+$/

async function fetchSingleTheme(slug: string): Promise<Preset> {
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`invalid slug "${slug}" — slugs must match ${SLUG_PATTERN}`)
  }
  const url = `${REGISTRY_BASE}/${slug}.json`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const data = (await res.json()) as RegistryItem
  return {
    slug,
    name: slugToName(slug),
    description: '',
    light: extractTokens(data.cssVars?.light ?? {}, slug, 'light'),
    dark: extractTokens(data.cssVars?.dark ?? {}, slug, 'dark'),
  }
}

async function probeSingleTheme(slug: string): Promise<Preset | null> {
  try {
    return await fetchSingleTheme(slug)
  } catch {
    return null
  }
}

function insertTheme(presets: Preset[], theme: Preset, after: string | null): void {
  let pos: number
  if (after) {
    const idx = presets.findIndex((p) => p.slug === after)
    if (idx === -1) {
      console.warn(`  [warn] --after "${after}" not found, appending at end`)
      presets.push(theme)
      pos = presets.length
    } else {
      presets.splice(idx + 1, 0, theme)
      pos = idx + 2
    }
  } else {
    presets.push(theme)
    pos = presets.length
  }
  console.log(`  + "${theme.name}" (${pos}/${presets.length})`)
}

async function fetchAll(): Promise<Preset[]> {
  console.log('Fetching registry.json...')
  const registryItems = await fetchRegistryIndex()
  console.log(`  Registry: ${registryItems.length} themes`)

  console.log('Fetching theme-presets.ts slug list...')
  const builtinSlugs = await fetchBuiltinSlugs()
  console.log(`  Built-in presets: ${builtinSlugs.length} slugs`)

  const seen = new Set(registryItems.map((t) => t.slug))
  const allThemes = [...registryItems]

  const missingBuiltins = builtinSlugs.filter((s) => !seen.has(s))
  if (missingBuiltins.length > 0) {
    console.log(`Fetching ${missingBuiltins.length} built-in(s) absent from registry: ${missingBuiltins.join(', ')}`)
    for (const slug of missingBuiltins) {
      process.stdout.write(`  Fetching "${slug}"... `)
      try {
        allThemes.push(await fetchSingleTheme(slug))
        seen.add(slug)
        console.log('OK')
      } catch (err) {
        console.log(`SKIPPED (${err instanceof Error ? err.message : String(err)})`)
      }
    }
  }

  const probeNeeded = PROBE_SLUGS.filter((s) => !seen.has(s))
  if (probeNeeded.length > 0) {
    console.log(`Probing ${probeNeeded.length} community slug(s): ${probeNeeded.join(', ')}`)
    for (const slug of probeNeeded) {
      process.stdout.write(`  Probing "${slug}"... `)
      const theme = await probeSingleTheme(slug)
      if (theme) {
        allThemes.push(theme)
        seen.add(slug)
        console.log('found')
      } else {
        console.log('not found, skipped')
      }
    }
  }

  return allThemes
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  if (!args.sync && !args.replace && args.slugs.length === 0) {
    console.error(
      'Usage:\n' +
        '  npm run themes:fetch -- --replace\n' +
        '  npm run themes:fetch -- --sync\n' +
        '  npm run themes:fetch -- <slug> [slug2 ...]\n' +
        '  npm run themes:fetch -- <slug> [--name "Display Name"] [--description "..."] [--after <slug>]',
    )
    process.exit(1)
  }

  let presets: Preset[]
  let added = 0

  if (args.replace) {
    presets = await fetchAll()
    added = presets.length
    console.log(`\nReplacing with ${presets.length} themes total.`)
  } else {
    try {
      presets = JSON.parse(fs.readFileSync(rawPresetsPath, 'utf8')) as Preset[]
    } catch (err) {
      throw new Error(
        `failed to parse ${rawPresetsPath}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    const ourSlugs = new Set(presets.map((p) => p.slug))

    if (args.sync) {
      const allThemes = await fetchAll()
      const eligible = allThemes.filter((item) => !ourSlugs.has(item.slug))
      console.log(`\nAvailable: ${allThemes.length} | Ours: ${ourSlugs.size} | New: ${eligible.length}`)
      if (eligible.length === 0) {
        console.log('Already up to date.')
        return
      }
      console.log(`Adding: ${eligible.map((t) => t.slug).join(', ')}`)
      for (const theme of eligible) {
        insertTheme(presets, theme, null)
        added++
      }
    } else {
      for (const slug of args.slugs) {
        if (ourSlugs.has(slug)) {
          console.log(`Skipping "${slug}" — already exists`)
          continue
        }
        process.stdout.write(`Fetching "${slug}"... `)
        try {
          const theme = await fetchSingleTheme(slug)
          console.log('OK')
          if (args.name) theme.name = args.name
          if (args.description) theme.description = args.description
          insertTheme(presets, theme, args.after)
          added++
        } catch (err) {
          console.log(`SKIPPED (${err instanceof Error ? err.message : String(err)})`)
        }
      }
    }
  }

  if (added === 0) {
    console.log('Nothing to add.')
    return
  }

  fs.writeFileSync(rawPresetsPath, JSON.stringify(presets, null, 2) + '\n', 'utf8')
  console.log(`\nSaved presets-raw.json (${presets.length} themes total)`)
  console.log('\nDone. Run "npm run themes:gen" to regenerate the CSS + TS registry.')
}

await main()
