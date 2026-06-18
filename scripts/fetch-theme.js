/**
 * Fetch tweakcn preset themes and add them to presets-raw.json,
 * then regenerate the CSS and TypeScript outputs.
 *
 * Sources used (union of all, auto-discovered from tweakcn's GitHub):
 *   1. public/r/registry.json  — curated list with cssVars (no individual fetches needed)
 *   2. utils/theme-presets.ts  — built-in preset slugs (fetched from per-theme endpoint)
 *
 * Community themes not in either source (e.g. "notebook", "darkmatter") are discovered
 * by probing the per-theme endpoint for a list of known-good slugs kept in PROBE_SLUGS.
 * Unlike EXTRA_SLUGS of old, PROBE_SLUGS is only probed when the slug is absent from
 * the two auto-discovered sources — so it only needs updating when a genuinely new
 * community theme appears that tweakcn hasn't added to their registry yet.
 *
 * Usage:
 *   node scripts/fetch-theme.js --replace
 *     Rebuild presets-raw.json from scratch using all sources.
 *
 *   node scripts/fetch-theme.js --sync
 *     Add any themes not yet in presets-raw.json. Preserves existing entries.
 *
 *   node scripts/fetch-theme.js <slug> [slug2 ...]
 *     Fetch specific themes by slug.
 *
 *   node scripts/fetch-theme.js <slug> [--name "Display Name"] [--description "..."] [--after <existing-slug>]
 *     Fetch one theme with custom metadata or insertion position.
 *
 * Examples:
 *   node scripts/fetch-theme.js --replace
 *   node scripts/fetch-theme.js --sync
 *   node scripts/fetch-theme.js ocean-breeze
 *   node scripts/fetch-theme.js catppuccin --after mocha-mousse
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const TWEAKCN_REGISTRY_URL =
  'https://raw.githubusercontent.com/jnsahaj/tweakcn/main/public/r/registry.json';

const TWEAKCN_PRESETS_URL =
  'https://raw.githubusercontent.com/jnsahaj/tweakcn/main/utils/theme-presets.ts';

const REGISTRY_BASE = 'https://tweakcn.com/r/themes';

// Community theme slugs not yet in registry.json or theme-presets.ts.
// Only add here when a theme appears on tweakcn.com but is absent from both auto-sources.
// These are probed (not assumed): if the endpoint returns 404 they are silently skipped.
const PROBE_SLUGS = ['notebook', 'darkmatter'];

// The subset of cssVars keys we track in presets-raw.json.
const THEME_KEYS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'radius',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
];

function slugToName(slug) {
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseArgs(argv) {
  const result = { slugs: [], name: null, description: null, after: null, sync: false, replace: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sync') result.sync = true;
    else if (argv[i] === '--replace') result.replace = true;
    else if (argv[i] === '--name') result.name = argv[++i];
    else if (argv[i] === '--description') result.description = argv[++i];
    else if (argv[i] === '--after') result.after = argv[++i];
    else result.slugs.push(argv[i]);
  }
  return result;
}

function extractTokens(cssVars, slug, mode) {
  const tokens = {};
  for (const key of THEME_KEYS) {
    if (cssVars[key] !== undefined) {
      tokens[key] = cssVars[key];
    } else {
      console.warn(`  [warn] "${slug}" ${mode} mode: missing key "${key}"`);
    }
  }
  return tokens;
}

// Source 1: registry.json — curated list with full cssVars (oklch).
async function fetchRegistryIndex() {
  const res = await fetch(TWEAKCN_REGISTRY_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching registry.json`);
  const data = await res.json();
  return data.items.map((item) => ({
    slug: item.name,
    name: item.title ?? slugToName(item.name),
    description: item.description ?? '',
    light: extractTokens(item.cssVars?.light ?? {}, item.name, 'light'),
    dark: extractTokens(item.cssVars?.dark ?? {}, item.name, 'dark'),
  }));
}

// Source 2: theme-presets.ts — extract slug names only (top-level object keys).
async function fetchBuiltinSlugs() {
  const res = await fetch(TWEAKCN_PRESETS_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching theme-presets.ts`);
  const text = await res.text();
  // Match lines like:  "slug-name": {   (exactly 2-space indent = top-level keys)
  const slugs = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^  "([a-z][a-z0-9-]+)":\s*\{/);
    if (m) slugs.push(m[1]);
  }
  return slugs;
}

// Per-theme endpoint — used for slugs not in registry.json.
async function fetchSingleTheme(slug) {
  const url = `${REGISTRY_BASE}/${slug}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const data = await res.json();
  return {
    slug,
    name: slugToName(slug),
    description: '',
    light: extractTokens(data.cssVars?.light ?? {}, slug, 'light'),
    dark: extractTokens(data.cssVars?.dark ?? {}, slug, 'dark'),
  };
}

// Probe a slug silently — returns theme on success, null on 404/error.
async function probeSingleTheme(slug) {
  try {
    return await fetchSingleTheme(slug);
  } catch {
    return null;
  }
}

function insertTheme(presets, theme, after) {
  if (after) {
    const idx = presets.findIndex((p) => p.slug === after);
    if (idx === -1) {
      console.warn(`  [warn] --after "${after}" not found, appending at end`);
      presets.push(theme);
    } else {
      presets.splice(idx + 1, 0, theme);
    }
  } else {
    presets.push(theme);
  }
  const pos = presets.findIndex((p) => p.slug === theme.slug) + 1;
  console.log(`  + "${theme.name}" (${pos}/${presets.length})`);
}

// Fetch all themes from all sources, deduplicated.
async function fetchAll() {
  console.log('Fetching registry.json...');
  const registryItems = await fetchRegistryIndex();
  console.log(`  Registry: ${registryItems.length} themes`);

  console.log('Fetching theme-presets.ts slug list...');
  const builtinSlugs = await fetchBuiltinSlugs();
  console.log(`  Built-in presets: ${builtinSlugs.length} slugs`);

  const seen = new Set(registryItems.map((t) => t.slug));
  const allThemes = [...registryItems];

  // Built-in slugs not yet covered by registry → fetch individually.
  const missingBuiltins = builtinSlugs.filter((s) => !seen.has(s));
  if (missingBuiltins.length > 0) {
    console.log(`Fetching ${missingBuiltins.length} built-in(s) absent from registry: ${missingBuiltins.join(', ')}`);
    for (const slug of missingBuiltins) {
      process.stdout.write(`  Fetching "${slug}"... `);
      try {
        const theme = await fetchSingleTheme(slug);
        allThemes.push(theme);
        seen.add(slug);
        console.log('OK');
      } catch (err) {
        console.log(`SKIPPED (${err.message})`);
      }
    }
  }

  // Probe community slugs absent from both sources.
  const probeNeeded = PROBE_SLUGS.filter((s) => !seen.has(s));
  if (probeNeeded.length > 0) {
    console.log(`Probing ${probeNeeded.length} community slug(s): ${probeNeeded.join(', ')}`);
    for (const slug of probeNeeded) {
      process.stdout.write(`  Probing "${slug}"... `);
      const theme = await probeSingleTheme(slug);
      if (theme) {
        allThemes.push(theme);
        seen.add(slug);
        console.log('found');
      } else {
        console.log('not found, skipped');
      }
    }
  }

  return allThemes;
}

// --- main ---

const args = parseArgs(process.argv.slice(2));

if (!args.sync && !args.replace && args.slugs.length === 0) {
  console.error(
    'Usage:\n' +
    '  node scripts/fetch-theme.js --replace\n' +
    '  node scripts/fetch-theme.js --sync\n' +
    '  node scripts/fetch-theme.js <slug> [slug2 ...]\n' +
    '  node scripts/fetch-theme.js <slug> [--name "Display Name"] [--description "..."] [--after <slug>]',
  );
  process.exit(1);
}

const rawPresetsPath = path.join(process.cwd(), 'src/lib/themes/presets-raw.json');

let presets;
let added = 0;

if (args.replace) {
  let allThemes;
  try {
    allThemes = await fetchAll();
  } catch (err) {
    console.error(`Failed: ${err.message}`);
    process.exit(1);
  }

  presets = allThemes;
  added = presets.length;
  console.log(`\nReplacing with ${presets.length} themes total.`);
} else {
  presets = JSON.parse(fs.readFileSync(rawPresetsPath, 'utf8'));
  const ourSlugs = new Set(presets.map((p) => p.slug));

  if (args.sync) {
    let allThemes;
    try {
      allThemes = await fetchAll();
    } catch (err) {
      console.error(`Failed: ${err.message}`);
      process.exit(1);
    }

    const eligible = allThemes.filter((item) => !ourSlugs.has(item.slug));
    console.log(`\nAvailable: ${allThemes.length} | Ours: ${ourSlugs.size} | New: ${eligible.length}`);

    if (eligible.length === 0) {
      console.log('Already up to date.');
      process.exit(0);
    }

    console.log(`Adding: ${eligible.map((t) => t.slug).join(', ')}`);
    for (const theme of eligible) {
      insertTheme(presets, theme, null);
      added++;
    }
  } else {
    // Individual slug mode.
    for (const slug of args.slugs) {
      if (ourSlugs.has(slug)) {
        console.log(`Skipping "${slug}" — already exists`);
        continue;
      }

      process.stdout.write(`Fetching "${slug}"... `);
      let theme;
      try {
        theme = await fetchSingleTheme(slug);
      } catch (err) {
        console.error(`FAILED: ${err.message}`);
        process.exit(1);
      }
      console.log('OK');

      if (args.name) theme.name = args.name;
      if (args.description) theme.description = args.description;

      insertTheme(presets, theme, args.after);
      added++;
    }
  }
}

if (added === 0) {
  console.log('Nothing to add.');
  process.exit(0);
}

fs.writeFileSync(rawPresetsPath, JSON.stringify(presets, null, 2) + '\n', 'utf8');
console.log(`\nSaved presets-raw.json (${presets.length} themes total)`);

console.log('Regenerating CSS and TypeScript...');
execSync('node scripts/generate-themes.js', { stdio: 'inherit' });
console.log('Done.');
