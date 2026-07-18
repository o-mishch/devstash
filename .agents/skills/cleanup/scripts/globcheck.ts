/**
 * Tests for rule resolution and changeset classification.
 *
 * Usage: node --test .agents/skills/cleanup/scripts/globcheck.ts
 *
 * Why this exists: the failure mode of a wrong matcher is a rule that silently
 * never loads — the audit still runs, still reports, and simply never applies
 * that rule. Nothing surfaces it. That bug has shipped three times here:
 *   1. SKILL.md's hand-maintained trigger table drifting from legacy-ops.md.
 *   2. This resolver keying on `trigger:` instead of `paths:`.
 *   3. `git status --porcelain` collapsing untracked directories, so a bare
 *      `backend/internal/x/` never matched `backend/**\/*.go`.
 * Each was invisible in the output. Hence tests rather than a manual read.
 *
 * The plan-improve.ts budget constants (GROUP_LOC_BUDGET, MERGE_UNITS_LOC_BUDGET,
 * QUICK_TIER_GROUP_THRESHOLD) are the same class of risk: a wrong value doesn't
 * error, it just silently changes agent count or coverage shape on every future
 * run. DESIGN.md documents why each is set where it is, but prose is not a gate —
 * these tests pin the boundary behavior so a future edit fails loudly instead.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  applyQuickTier,
  applyStackTier,
  GROUP_UNITS,
  isQuickTier,
  MERGED_GROUP_UNITS,
  unitsFor,
  type Group,
} from './plan-improve.ts'
import {
  changedFiles,
  classifyChangeset,
  frontmatterList,
  frontmatterScalar,
  isIgnored,
  pathMatches,
  readRules,
  repoRoot,
} from './lib/rules.ts'

process.chdir(repoRoot())

interface GlobCase {
  glob: string
  path: string
  want: boolean
}

// These assert that node:path's matchesGlob does what this repo's rules need.
// The hand-rolled glob→regex engine it replaced needed sentinel-character
// tricks to make `**\/` match zero directories; these are the cases that pinned
// its behavior, kept to pin the built-in's.
const GLOB_CASES: GlobCase[] = [
  // Shared frontend globs must not leak across the src/ | web/ boundary.
  { glob: 'web/**/*.tsx', path: 'web/src/components/items/item-card.tsx', want: true },
  { glob: 'web/**/*.ts', path: 'web/src/hooks/use-items.ts', want: true },
  { glob: 'web/**/*', path: 'web/src/stores/ui.ts', want: true },
  { glob: 'src/**/*.ts', path: 'web/src/hooks/use-items.ts', want: false },
  { glob: 'src/**/*.tsx', path: 'web/src/components/items/item-card.tsx', want: false },
  { glob: 'backend/**/*.go', path: 'web/src/x.go', want: false },

  // legacy-ops.md's real globs — the row that drifted in SKILL.md's old table.
  { glob: 'package.json', path: 'package.json', want: true },
  { glob: 'package.json', path: 'web/package.json', want: false },
  { glob: 'package.json', path: 'backend/tools/package.json', want: false },
  { glob: '.env*', path: '.env', want: true },
  { glob: '.env*', path: '.env.local', want: true },
  { glob: '.env*', path: 'web/.env.local', want: false },
  { glob: 'prisma/**/*', path: 'prisma/schema.prisma', want: true },
  { glob: 'prisma/**/*', path: 'prisma/migrations/001/migration.sql', want: true },

  // `**/` must match zero directories as well as many.
  { glob: 'src/**/*.ts', path: 'src/auth.ts', want: true },
  { glob: 'src/**/*.ts', path: 'src/lib/db/items.ts', want: true },
  { glob: 'backend/**/*.go', path: 'backend/main.go', want: true },
  { glob: 'backend/**/*.go', path: 'backend/internal/items/list.go', want: true },
  { glob: 'src/app/api/**/route.ts', path: 'src/app/api/route.ts', want: true },
  { glob: 'src/app/api/**/route.ts', path: 'src/app/api/items/route.ts', want: true },

  // Exact-file globs must not match siblings.
  { glob: 'src/auth.ts', path: 'src/auth.ts', want: true },
  { glob: 'src/auth.ts', path: 'src/auth.config.ts', want: false },

  // `*` must not cross a path segment.
  { glob: 'infra/cli/**/*.py', path: 'infra/cli/a/b.py', want: true },
  { glob: 'infra/cli/**/*.py', path: 'infra/other/b.py', want: false },

  // A directory path must NOT satisfy a suffix glob. This is failure #3 above:
  // when the inventory collapsed untracked dirs, `backend/internal/foo/` was
  // fed to the matcher and go-coding-standards.md silently never loaded.
  { glob: 'backend/**/*.go', path: 'backend/internal/foo/', want: false },
  { glob: 'web/**/*.tsx', path: 'web/src/routes/', want: false },
]

void test('glob matching', () => {
  GLOB_CASES.forEach(({ glob, path, want }) => {
    assert.equal(pathMatches(path, [glob]), want, `${glob} vs ${path}`)
  })
})

void test('frontmatter: block list form', () => {
  const source = ['---', 'trigger: glob', 'paths:', '  - "web/**/*"', '  - "src/**/*.ts"', 'description: x', '---', '', '# Body'].join('\n')
  assert.deepEqual(frontmatterList(source, 'paths'), ['web/**/*', 'src/**/*.ts'])
  assert.equal(frontmatterScalar(source, 'trigger'), 'glob')
})

void test('frontmatter: inline array form (go-coding-standards.md uses it)', () => {
  const source = ['---', 'trigger: glob', 'globs: ["backend/**/*.go"]', 'paths:', '  - "backend/**/*.go"', '---'].join('\n')
  assert.deepEqual(frontmatterList(source, 'globs'), ['backend/**/*.go'])
  assert.deepEqual(frontmatterList(source, 'paths'), ['backend/**/*.go'])
})

void test('frontmatter: a missing key is empty, not a crash', () => {
  const source = ['---', 'trigger: always_on', 'description: x', '---'].join('\n')
  assert.deepEqual(frontmatterList(source, 'paths'), [])
  assert.deepEqual(frontmatterList(source, 'generated'), [])
})

void test('frontmatter: a list key stops at the next key', () => {
  const source = ['---', 'paths:', '  - "a/**/*"', 'generated:', '  - "b/**/*"', '---'].join('\n')
  assert.deepEqual(frontmatterList(source, 'paths'), ['a/**/*'])
  assert.deepEqual(frontmatterList(source, 'generated'), ['b/**/*'])
})

void test('frontmatter: no frontmatter at all is empty, not a crash', () => {
  assert.deepEqual(frontmatterList('# Just a heading\n', 'paths'), [])
  assert.equal(frontmatterScalar('# Just a heading\n', 'trigger'), null)
})

// paths: is the authoritative field — it is the only one Claude Code scopes on,
// and its presence is what makes a rule path-scoped rather than load-at-launch.
// trigger: is Antigravity's, inferred and unverified, so it is cross-checked but
// never keyed on: a rule with paths: and a typo'd trigger: must still resolve.
void test('rule classification keys on paths:, not trigger:', () => {
  const typo = ['---', 'trigger: gloB_TYPO', 'paths:', '  - "web/**/*"', '---'].join('\n')
  assert.deepEqual(frontmatterList(typo, 'paths'), ['web/**/*'])
  assert.ok(pathMatches('web/src/x.tsx', frontmatterList(typo, 'paths')))
  assert.equal(frontmatterScalar(typo, 'trigger'), 'gloB_TYPO')
})

void test('changeset contains real files only, never directories', () => {
  const dirs = changedFiles().filter((path) => path.endsWith('/'))
  assert.deepEqual(dirs, [], 'a directory in the changeset means untracked dirs collapsed again')
})

void test('changeset matches git, with untracked directories expanded', () => {
  const expected = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.length > 0)
  const actual = new Set(changedFiles())
  const missing = expected.filter((path) => !actual.has(path))
  assert.deepEqual(missing, [], 'untracked files missing from the changeset')
})

// context/ is the project's own bookkeeping — the housekeeping checks read it,
// but it is never a lens-audit or scope target. Pinned on synthetic paths so it
// holds regardless of the working tree's state.
void test('context/ is excluded from the audit, code dirs are not', () => {
  assert.ok(isIgnored('context/history.md'))
  assert.ok(isIgnored('context/migration-log.md'))
  assert.ok(isIgnored('context/current-feature.md'))
  assert.ok(!isIgnored('web/src/routes/index.tsx'))
  assert.ok(!isIgnored('backend/internal/items/list.go'))
  assert.ok(!isIgnored('src/lib/db/items.ts'))
})

void test('classifyChangeset excludes context/ from every bucket', () => {
  const { all, generated, handWritten } = classifyChangeset(readRules())
  const stray = [...all, ...generated, ...handWritten].filter((path) => path.startsWith('context/'))
  assert.deepEqual(stray, [], 'context/ leaked into the audit changeset')
})

void test('generated classification splits the changeset without losing a file', () => {
  const { all, generated, handWritten } = classifyChangeset(readRules())
  assert.equal(generated.length + handWritten.length, all.length)
  assert.deepEqual(
    generated.filter((path) => handWritten.includes(path)),
    [],
    'a file classified both generated and hand-written',
  )
})

void test('rules declaring generated artifacts classify them as generated', () => {
  const globs = readRules().flatMap((rule) => rule.generated)
  const shouldBeGenerated = [
    'web/src/client/sdk.gen.ts',
    'web/src/routeTree.gen.ts',
    'web/src/styles/themes.generated.css',
    'web/src/lib/theme-presets.generated.ts',
    'web/src/components/ui/button.tsx',
    'backend/internal/db/items.sql.go',
    'src/types/openapi.ts',
  ]
  const shouldNot = [
    'web/src/router.tsx',
    'web/src/lib/utils.ts',
    'web/src/components/items/item-card.tsx',
    'backend/internal/items/list.go',
    // Hand-written despite sitting in legacy-coding-standards.md's lint-ignore
    // list alongside two generated paths — it is merely lint-ignored.
    'prisma.config.ts',
  ]
  shouldBeGenerated.forEach((path) => assert.ok(pathMatches(path, globs), `${path} should be generated`))
  shouldNot.forEach((path) => assert.ok(!pathMatches(path, globs), `${path} should NOT be generated`))
})

/**
 * web-architecture.md states its generated files twice: the `generated:`
 * frontmatter (machine-readable) and a body table (human-readable). Two copies
 * of one fact drift — that is this skill's oldest bug. They are co-located and
 * this test fails the moment they disagree, which is the deal the rule's prose
 * promises its readers.
 */
void test('web-architecture.md: generated: frontmatter matches its body table', () => {
  const source = readFileSync('.agents/rules/web-architecture.md', 'utf8')
  const section = source.slice(source.indexOf('## Generated files'))
  const tableParagraph = section.slice(0, section.indexOf('\n\n', section.indexOf('| Path |')))

  const tablePaths = tableParagraph
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => line.split('|')[1].trim().replace(/`/g, ''))

  const declared = frontmatterList(source, 'generated')
  assert.deepEqual([...tablePaths].sort(), [...declared].sort(), 'the table and the generated: key disagree')
})

// Pins MERGE_UNITS_LOC_BUDGET (150). DESIGN.md warns against raising this to cut
// agent count — a test, not just the prose, is what makes a silent change to it
// fail loudly.
void test('unitsFor: merge threshold at 150 LOC', () => {
  assert.deepEqual(unitsFor(150), MERGED_GROUP_UNITS, '150 LOC must still merge')
  assert.deepEqual(unitsFor(151), GROUP_UNITS, '151 LOC must split into the usual two units')
})

// Pins QUICK_TIER_GROUP_THRESHOLD (3). A changeset with 0 groups (nothing to
// review) is not a "tier" — there is no run to downgrade.
void test('isQuickTier: group-count threshold at 3', () => {
  assert.equal(isQuickTier(0), false, 'no groups means nothing to run, not a quick-tier run')
  assert.equal(isQuickTier(1), true)
  assert.equal(isQuickTier(3), true, '3 groups is still within the quick tier')
  assert.equal(isQuickTier(4), false, '4 groups must run the normal two-unit + Verify shape')
})

void test('applyQuickTier: forces every group to the merged unit, changes nothing otherwise', () => {
  const groups: Group[] = [
    { id: 'g01', area: 'a', files: ['a/x.ts'], loc: 400, units: GROUP_UNITS },
    { id: 'g02', area: 'b', files: ['b/y.ts'], loc: 400, units: GROUP_UNITS },
  ]

  const quick = applyQuickTier(groups, true)
  assert.ok(
    quick.every((group) => group.units === MERGED_GROUP_UNITS),
    'every group must run its merged unit under the quick tier, regardless of its own LOC',
  )

  const normal = applyQuickTier(groups, false)
  assert.deepEqual(normal, groups, 'quickTier: false must be a no-op')
})

// src/ is maintenance-only (boundary.md): its groups run the merged unit so the
// skill spends one finder, not two, deepening review there — but P3/P4 + Verify
// still run (the security/bug floor). web/ and backend/ keep their size-based
// units. A wrong prefix here would silently under- or over-review a whole stack.
void test('applyStackTier: src/ forces the merged unit; web/ and backend/ keep size-based units', () => {
  const groups: Group[] = [
    { id: 'g01', area: 'src/lib/db', files: ['src/lib/db/items.ts'], loc: 400, units: GROUP_UNITS },
    // area is the bare workspace segment for root-level files (src/auth.ts →
    // 'src'): a prefix match on 'src/' would miss exactly the auth files.
    { id: 'g02', area: 'src', files: ['src/auth.ts'], loc: 400, units: GROUP_UNITS },
    { id: 'g03', area: 'web/src/routes', files: ['web/src/routes/x.tsx'], loc: 400, units: GROUP_UNITS },
    { id: 'g04', area: 'backend/internal/items', files: ['backend/internal/items/list.go'], loc: 400, units: GROUP_UNITS },
  ]

  const tiered = applyStackTier(groups)
  assert.deepEqual(tiered[0].units, MERGED_GROUP_UNITS, 'src/ must force the merged unit regardless of LOC')
  assert.deepEqual(tiered[1].units, MERGED_GROUP_UNITS, 'root-level src (area "src") must also merge')
  assert.deepEqual(tiered[2].units, GROUP_UNITS, 'web/ must keep its two-unit split')
  assert.deepEqual(tiered[3].units, GROUP_UNITS, 'backend/ must keep its two-unit split')
})

// The p4 lens splits its stack-specific signals into per-stack companion fragments
// (p4.web.md, …) that improve-audit.js loads by a group's stack. A renamed or emptied
// companion silently drops that stack's P4 signals — the exact "loads nothing, errors
// nowhere" failure this file exists to catch — and the loader lives in the untestable
// .js workflow. So pin the split here: each companion is present and non-empty, carries
// its own stack's signal, and that signal has actually LEFT the shared p4.md.
void test('p4 per-stack fragments: companions exist and the split landed in the right file', () => {
  const base = '.agents/skills/cleanup/references/improve'
  const shared = readFileSync(`${base}/p4.md`, 'utf8')

  // marker: a phrase unique to that stack's signals, absent from the shared fragment.
  const companions: Record<string, string> = {
    'p4.src.md': 'Pino',
    'p4.web.md': 'invalidateQueries',
    'p4.backend.md': 'ctx.Done',
  }

  Object.entries(companions).forEach(([file, marker]) => {
    const body = readFileSync(`${base}/${file}`, 'utf8') // throws (fails) if the companion is gone
    assert.ok(body.trim().length > 0, `${file} must be non-empty`)
    assert.ok(body.includes(marker), `${file} must carry its stack signal (${marker})`)
    assert.ok(!shared.includes(marker), `p4.md must not still hold ${marker} — it moved to ${file}`)
  })
})
