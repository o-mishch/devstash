/**
 * Extract the structure P1 and P2 judge, so they never read raw source.
 *
 * Usage: node extract-structure.ts --plan <plan.json> [--out <structure.json>]
 *
 * P1 (architecture) and P2 (DRY) are properties of the changeset as a set — one
 * file cannot contain a duplicated guard. The obvious move is one agent that
 * reads everything, but "everything" here is ~15k LOC (~170k tokens), squarely
 * in the regime where recall collapses. You cannot find duplication by having a
 * model squint at 170k tokens.
 *
 * So detect deterministically, and let the agent judge candidates instead. jscpd
 * (Rabin-Karp) finds clones exactly and identically every run; the import graph
 * and symbol inventory are mechanical. Each agent then reads a few hundred
 * tokens of candidates rather than the whole tree — smaller context, higher
 * recall, and a duplication answer that no longer varies between runs.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyChangeset, readRules, repoRoot } from './lib/rules.ts'
import type { Plan } from './plan-improve.ts'

/**
 * Pinned, not floating: `npx jscpd@latest` would let a detector upgrade silently
 * change which clones this audit reports, and a changed finding set with no
 * changed code is the exact variance this pipeline exists to remove. Bump it
 * deliberately, and re-check `normaliseClones` — the sort and the dropped
 * `detectionDate` below compensate for reporter behavior, not a stable contract.
 */
const JSCPD_VERSION = '5.0.12'

/** Below this, a "clone" is boilerplate (an import block, a props interface). */
const MIN_TOKENS = 50

/**
 * The three workspaces boundary.md declares. A clone spanning two of them is
 * NOT a finding: boundary.md states that copying source from `src/` into `web/`
 * — and duplicating logic per-stack generally — is "explicitly allowed and
 * expected", because each workspace has its own dependency graph and build.
 * "Two independent copies that happen to match is the goal."
 *
 * This matters more than it looks. On the changeset that motivated this rework,
 * 116 of 122 raw clone candidates (95%) were src<->web pairs. Feeding those to
 * P2 would have produced 116 rule-sanctioned false positives on every run —
 * worse than the sampling problem this file exists to fix. Directories outside
 * these three (e.g. `prototypes/`) are not workspaces, so clones against them
 * stay candidates.
 */
const WORKSPACES = new Set(['src', 'web', 'backend'])

const CODE_FORMATS = 'typescript,tsx,javascript,jsx,go,python,css,sql'

export interface Clone {
  lines: number
  tokens: number
  format: string
  first: { file: string; start: number; end: number }
  second: { file: string; start: number; end: number }
}

export interface ImportEdge {
  file: string
  imports: string[]
}

/**
 * One file's exported names. Grouped by file rather than one row per symbol:
 * the flat form was 19k tokens for this changeset, and the whole point of
 * extracting structure is to hand P2 a payload it can actually hold. Grouping
 * drops it by ~4x with no information lost that the lens uses.
 */
export interface SymbolEntry {
  file: string
  names: string[]
}

export interface Structure {
  /** Cross-file clone candidates touching the changeset, rule-filtered and sorted. */
  clones: Clone[]
  /** What each changed file imports — P1's view of layering and coupling. */
  imports: ImportEdge[]
  /** Exports that already exist outside the changeset — P2's "does this already exist?" */
  inventory: SymbolEntry[]
  notes: string[]
}

function workspaceOf(path: string): string {
  return path.split('/')[0]
}

function sanctionedCrossStack(a: string, b: string): boolean {
  const wa = workspaceOf(a)
  const wb = workspaceOf(b)
  return wa !== wb && WORKSPACES.has(wa) && WORKSPACES.has(wb)
}

interface JscpdFile {
  name: string
  start: number
  end: number
}

interface JscpdDuplicate {
  lines: number
  tokens: number
  format: string
  firstFile: JscpdFile
  secondFile: JscpdFile
}

/**
 * jscpd's JSON reporter applies no sorting — its own docs say the order is
 * non-deterministic — and `statistics.detectionDate` changes every run. Both are
 * dropped or normalised here: feeding an unsorted, timestamped blob into the
 * work-list would rebuild the run-to-run variance this whole rework removes,
 * using the tool meant to eliminate it.
 */
export function normaliseClones(duplicates: JscpdDuplicate[], inScope: Set<string>): Clone[] {
  return duplicates
    .filter((d) => inScope.has(d.firstFile.name) || inScope.has(d.secondFile.name))
    .filter((d) => d.firstFile.name !== d.secondFile.name) // within-file repetition is not a DRY finding
    .filter((d) => !sanctionedCrossStack(d.firstFile.name, d.secondFile.name))
    .map((d) => ({
      lines: d.lines,
      tokens: d.tokens,
      format: d.format,
      first: { file: d.firstFile.name, start: d.firstFile.start, end: d.firstFile.end },
      second: { file: d.secondFile.name, start: d.secondFile.start, end: d.secondFile.end },
    }))
    .sort(
      (a, b) =>
        a.first.file.localeCompare(b.first.file) ||
        a.first.start - b.first.start ||
        a.second.file.localeCompare(b.second.file) ||
        a.second.start - b.second.start,
    )
}

function detectClones(inScope: Set<string>, generated: string[], notes: string[]): Clone[] {
  const out = mkdtempSync(join(tmpdir(), 'cleanup-cpd-'))
  const ignore = [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
    '**/.venv/**',
    // backend/exercise is an unrelated learning course, per go-coding-standards.md.
    'backend/exercise/**',
    ...generated,
  ].join(',')

  try {
    execFileSync(
      'npx',
      [
        '--yes',
        `jscpd@${JSCPD_VERSION}`,
        '.',
        '--reporters',
        'json',
        '--output',
        out,
        '--min-tokens',
        String(MIN_TOKENS),
        '--format',
        CODE_FORMATS,
        '--ignore',
        ignore,
        '--silent',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (error) {
    // Never fail the audit for a missing detector — report the gap instead, so
    // the coverage ledger can say P2's duplication pass did not run rather than
    // implying a clean result. jscpd also exits 0 on clones by design, so a
    // throw here is a real failure (no network, npx unavailable), not a finding.
    notes.push(`duplication detection did not run (${String(error).split('\n')[0]}) — P2 clone candidates unavailable`)
    return []
  }

  const report = join(out, 'jscpd-report.json')
  if (!existsSync(report)) {
    notes.push('duplication detection produced no report — P2 clone candidates unavailable')
    return []
  }
  // Same degrade-not-fail contract as the exec above: a malformed or unreadable
  // report means P2's duplication pass is unavailable, not that the audit failed.
  try {
    const parsed = JSON.parse(readFileSync(report, 'utf8')) as { duplicates: JscpdDuplicate[] }
    return normaliseClones(parsed.duplicates, inScope)
  } catch (error) {
    notes.push(`duplication report could not be parsed (${String(error).split('\n')[0]}) — P2 clone candidates unavailable`)
    return []
  }
}

/**
 * Regex, not a parser: Node ships no TypeScript AST, and a skill must run with
 * no dependencies. That is a real limitation — a dynamic `await import(expr)` is
 * invisible here. It is acceptable because this output is a *lead* for an agent
 * that then reads the code and judges, not a correctness gate. Anything relying
 * on completeness must not be built on this.
 */
const IMPORT_RE = /^\s*(?:import\s[^'"]*from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|export\s[^'"]*from\s*['"]([^'"]+)['"])/gm

export function extractImports(source: string): string[] {
  const found = [...source.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3])
  return [...new Set(found)].sort()
}

// No `enum` alternative: `typescript-standards.md § Skill scripts` forbids enum syntax
// anywhere under .agents/skills/**/*.ts (erasable-syntax-only, bare-node execution), so no
// in-scope file can legally contain one — matching it here would be dead code.
const EXPORT_RE = /^export\s+(?:async\s+)?(function|const|let|class|interface|type)\s+([A-Za-z_$][\w$]*)/gm

interface ExportedSymbol {
  kind: string
  name: string
}

export function extractExports(source: string): ExportedSymbol[] {
  return [...source.matchAll(EXPORT_RE)].map((m) => ({ kind: m[1], name: m[2] }))
}

/**
 * The exported surface of the workspaces the changeset touches — P2's "does the
 * stack already provide this?" lens. Scoped to those workspaces; a `web/` change
 * has no use for `backend/`'s Go symbols.
 *
 * Two inclusions that look wrong and are not:
 *
 * - Changed files are IN. The obvious reading is "compare new code against the
 *   incumbent", but on a new workspace there is no incumbent — `web/` is
 *   entirely untracked here, and excluding changed files produced an inventory
 *   of exactly zero. Two new files reinventing the same helper is a DRY finding
 *   whether or not either existed yesterday.
 * - Generated files are IN. They are excluded from a lens *audit* because
 *   nobody wrote them, but their exports are precisely the surface the stack
 *   provides: references/improve/p2.md asks whether changed code reimplements
 *   a generated `web/src/client` operation or a `web/src/components/ui`
 *   primitive. Dropping them blinds the lens to its own stated question.
 */
function buildInventory(changed: Set<string>): SymbolEntry[] {
  const touched = [...new Set([...changed].map(workspaceOf))].filter((ws) => WORKSPACES.has(ws)).sort()
  if (touched.length === 0) return []

  const list = (...args: string[]): string[] =>
    execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\0').filter((p) => p.length > 0)

  const files = [...new Set([...list('ls-files', '-z', ...touched), ...list('ls-files', '--others', '--exclude-standard', '-z', ...touched)])]
    .filter((path) => /\.(ts|tsx|js|jsx)$/.test(path))
    .filter((path) => existsSync(path))

  return files
    .map((file) => ({ file, names: [...new Set(extractExports(readFileSync(file, 'utf8')).map((sym) => sym.name))].sort() }))
    .filter((entry) => entry.names.length > 0)
    .sort((a, b) => a.file.localeCompare(b.file))
}

function main(): void {
  process.chdir(repoRoot())

  const planFlag = process.argv.indexOf('--plan')
  const planPath = planFlag === -1 ? '.cleanup-plan.json' : process.argv[planFlag + 1]
  let plan: Plan
  try {
    plan = JSON.parse(readFileSync(planPath, 'utf8')) as Plan
  } catch (error) {
    process.stderr.write(`could not read plan ${planPath}: ${String(error).split('\n')[0]}\n`)
    process.exit(1)
  }

  const inScope = new Set(plan.groups.flatMap((group) => group.files))
  const notes: string[] = []

  const rules = readRules()
  const generatedGlobs = rules.flatMap((rule) => rule.generated)
  const { all } = classifyChangeset(rules)

  const structure: Structure = {
    clones: detectClones(inScope, generatedGlobs, notes),
    imports: [...inScope]
      .sort()
      .map((file) => ({ file, imports: extractImports(readFileSync(file, 'utf8')) }))
      .filter((edge) => edge.imports.length > 0),
    inventory: buildInventory(new Set(all)),
    notes,
  }

  const outFlag = process.argv.indexOf('--out')
  const outPath = outFlag === -1 ? '.cleanup-structure.json' : process.argv[outFlag + 1]
  try {
    writeFileSync(outPath, `${JSON.stringify(structure, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`could not write structure to ${outPath}: ${String(error).split('\n')[0]}\n`)
    process.exit(1)
  }

  process.stdout.write(
    [
      '## Extracted structure',
      '',
      `structure: ${outPath}`,
      `clone candidates: ${structure.clones.length} (cross-file, touching the changeset, cross-stack pairs excluded per boundary.md)`,
      `import edges: ${structure.imports.length}`,
      `incumbent exports (P2 "already exists?"): ${structure.inventory.length}`,
      ...structure.notes.map((note) => `NOTE: ${note}`),
      '',
    ].join('\n'),
  )
}

main()
