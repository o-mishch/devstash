/**
 * Build the improve audit's work-list: every (group x finder unit), enumerated.
 *
 * Usage: node plan-improve.ts [--out <path>]   (default: .cleanup-plan.json)
 *
 * Writes two things:
 *   - the plan index (--out), read by the skill, never by a fan-out agent;
 *   - one small file per group under GROUP_DIR, read by exactly one agent each.
 *
 * Why the split, why groups are ~500 LOC, and why P4+P5 share a unit while P3
 * does not: ../DESIGN.md. Only this file's output is ever context.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { classifyChangeset, lineCount, pathMatches, readRules, repoRoot, type Rule } from './lib/rules.ts'

/** ~500 LOC keeps a group near 6k tokens of code. Do not raise it — see DESIGN.md. */
const GROUP_LOC_BUDGET = 500

/**
 * At or below this size, a group's fixed overhead (doctrine + lens fragments +
 * ruleFiles, often 10k+ tokens) dwarfs the code being reviewed, so it runs as one
 * merged unit (P3+P4+P5 in a single agent) instead of the usual two. This does
 * not touch P3's isolation for a normal-sized group — see DESIGN.md — it only
 * collapses the case where two agents would mostly be re-paying the same fixed
 * cost to review a handful of lines. Kept well below GROUP_LOC_BUDGET on purpose.
 * Rule-file weight (often 15-25 KB across 2-5 matched files) dominates code even
 * up to ~150 LOC, not just tiny groups — raised from 50 to reflect that.
 */
const MERGE_UNITS_LOC_BUDGET = 150

/** One file per group lands here; the workflow derives each path from the group id. */
const GROUP_DIR = '.cleanup-groups'

/**
 * At or below this many groups, the changeset is small enough that the full
 * two-unit-per-group + Sonnet-verify shape mostly re-pays fixed overhead rather
 * than buying coverage. The plan then forces every group to its merged unit
 * (P3P4P5, one agent) and the workflow skips the Verify refutation pass —
 * `quickTier: true` in the plan output says so explicitly, and the report must
 * surface it rather than silently presenting a smaller audit as the usual one.
 * This is a cost floor, not a correctness cut: every group is still enumerated
 * and fanned out, never sampled — see DESIGN.md.
 */
const QUICK_TIER_GROUP_THRESHOLD = 3

/**
 * Extensions a lens can actually say something about.
 *
 * Everything else is still reported under "Scope reviewed" — nothing is silently
 * dropped — but gets no finder, because the lenses do not apply: there is no IDOR
 * in an `.svg`, no missing `await` in a `.gitignore`. Prose docs are covered by
 * the housekeeping checks instead. Generated artifacts never reach here; they are
 * filtered earlier, by each rule's own `generated:` key.
 */
const LENS_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.go', '.py', '.css', '.sh', '.sql'])

function isLensAuditable(path: string): boolean {
  const cut = path.lastIndexOf('.')
  return cut !== -1 && LENS_EXTENSIONS.has(path.slice(cut))
}

export interface Lens {
  id: string
  title: string
  /** Per-file lenses fan out over groups; cross-cutting ones read extracted structure. */
  scope: 'group' | 'changeset'
}

/**
 * P1 and P2 are changeset-wide because their findings are properties of the set,
 * not of a file — one file cannot contain a duplicated guard. They read
 * deterministically extracted structure (clone candidates, an import graph, a
 * symbol inventory) rather than 15k lines of source. See extract-structure.ts.
 */
export const LENSES: Lens[] = [
  { id: 'P1', title: 'Architecture', scope: 'changeset' },
  { id: 'P2', title: 'KISS and DRY', scope: 'changeset' },
  { id: 'P3', title: 'Security and Access', scope: 'group' },
  { id: 'P4', title: 'Bugs, Regressions, and Logging', scope: 'group' },
  { id: 'P5', title: 'Convention, Hygiene, and Tests', scope: 'group' },
]

/**
 * A finder unit is one agent over one group. P4 and P5 share one — both are
 * close-reads of the same source for defects, and a second agent would re-read
 * the group and re-buy its whole payload to do it. P3 stays alone on purpose,
 * except in a merged group (below MERGE_UNITS_LOC_BUDGET) — see there. Findings
 * still carry their own lens id, so the report is unchanged either way.
 */
export interface Unit {
  id: string
  lensIds: string[]
}

/** The normal, two-agent split for a group at or above MERGE_UNITS_LOC_BUDGET. */
export const GROUP_UNITS: Unit[] = [
  { id: 'P3', lensIds: ['P3'] },
  { id: 'P4P5', lensIds: ['P4', 'P5'] },
]

/** The merged, one-agent split for a group at or below MERGE_UNITS_LOC_BUDGET. */
export const MERGED_GROUP_UNITS: Unit[] = [{ id: 'P3P4P5', lensIds: ['P3', 'P4', 'P5'] }]

/** Which unit set a group of this size runs — same rule plan-improve.ts and the report both use. */
export function unitsFor(loc: number): Unit[] {
  return loc <= MERGE_UNITS_LOC_BUDGET ? MERGED_GROUP_UNITS : GROUP_UNITS
}

/** Whether a changeset of this many groups runs the quick tier — see QUICK_TIER_GROUP_THRESHOLD. */
export function isQuickTier(groupCount: number): boolean {
  return groupCount > 0 && groupCount <= QUICK_TIER_GROUP_THRESHOLD
}

/** Force every group to its merged unit under the quick tier; a no-op otherwise. */
export function applyQuickTier(groups: Group[], quickTier: boolean): Group[] {
  return quickTier ? groups.map((group) => ({ ...group, units: MERGED_GROUP_UNITS })) : groups
}

/**
 * Stacks whose groups run the merged single finder unit (P3P4P5) regardless of
 * LOC. src/ is maintenance-only (boundary.md): a real change is still audited for
 * security (P3) and bugs (P4) and still goes through Verify — the floor — but the
 * skill does not spend a second finder deepening P5 convention/hygiene review on a
 * stack that gets no new features. web/ and backend/ keep the full two-unit split.
 * Verify is untouched here — it is gated on quickTier, not on unit count — so a
 * merged src/ group's uncertain findings are still refuted. See DESIGN.md.
 */
export const MERGED_UNIT_STACKS = ['src']

export function isMergedUnitStack(area: string): boolean {
  // Match the workspace segment, not a prefix: a group of root-level files has
  // area `src` (no slash), so `startsWith('src/')` would miss src/auth.ts et al.
  return MERGED_UNIT_STACKS.includes(area.split('/')[0])
}

/** Force deprioritized-stack groups to the merged unit; a no-op for other stacks. */
export function applyStackTier(groups: Group[]): Group[] {
  return groups.map((group) => (isMergedUnitStack(group.area) ? { ...group, units: MERGED_GROUP_UNITS } : group))
}

export interface Group {
  id: string
  /** The directory these files share — a group never straddles a directory. */
  area: string
  files: string[]
  loc: number
  /** Set once by buildGroups() via unitsFor(loc) — the single source, never recomputed downstream. */
  units: Unit[]
}

/** What one finder reads: its own group, and only the rules its own files can break. */
export interface GroupFile extends Group {
  ruleFiles: string[]
}

export interface PlanTotals {
  files: number
  loc: number
  groups: number
  finderAgents: number
}

export interface Plan {
  groups: Group[]
  lenses: Lens[]
  /** Where the per-group files were written. Agents read these, never this plan. Each group
   *  file carries its own "units" — small groups merge to one unit; see unitsFor(). */
  groupDir: string
  /** Changeset-wide rules, for the changeset-scoped lenses. Groups scope their own. */
  ruleFiles: string[]
  /** Rule-declared artifacts: hand-edit check only, never a lens audit. */
  generated: string[]
  /** Deleted paths — in the changeset but unreadable; callers still need review. */
  deleted: string[]
  /** Changed, but no lens applies (assets, docs, config). Reported, not audited. */
  notLensed: string[]
  totals: PlanTotals
  /** True at or below QUICK_TIER_GROUP_THRESHOLD groups: every group forced to its
   *  merged unit and the workflow skips Verify. Report must surface this, never
   *  imply the usual two-unit + Verify shape ran. */
  quickTier: boolean
}

function dirOf(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '.' : path.slice(0, cut)
}

/**
 * Pack files into ~GROUP_LOC_BUDGET groups, never splitting a file and never
 * straddling a directory. Sibling files review better together — they share
 * imports and idioms — and the directory is also the natural unit for the
 * report's "Scope reviewed" table. A file larger than the budget becomes its own
 * group rather than being cut.
 */
export function buildGroups(files: string[]): Group[] {
  const byDir = new Map<string, string[]>()
  files.forEach((file) => {
    const dir = dirOf(file)
    byDir.set(dir, [...(byDir.get(dir) ?? []), file])
  })

  const packed: Group[] = []

  ;[...byDir.keys()].sort().forEach((dir) => {
    let batch: string[] = []
    let loc = 0

    const flush = (): void => {
      if (batch.length === 0) return
      packed.push({ id: '', area: dir, files: batch, loc, units: unitsFor(loc) })
      batch = []
      loc = 0
    }

    ;[...(byDir.get(dir) ?? [])].sort().forEach((file) => {
      const fileLoc = lineCount(file)
      if (batch.length > 0 && loc + fileLoc > GROUP_LOC_BUDGET) flush()
      batch.push(file)
      loc += fileLoc
      if (loc >= GROUP_LOC_BUDGET) flush()
    })
    flush()
  })

  // IDs are assigned after packing so they are stable and sequential. Groups are
  // packed from a sorted file list into sorted directories, so an unchanged
  // changeset always yields an identical plan — the workflow's resume cache and
  // the ledger's run-to-run comparison both depend on that.
  return packed.map((group, index) => ({ ...group, id: `g${String(index + 1).padStart(2, '0')}` }))
}

export function matchingRuleFiles(rules: Rule[], changed: string[]): string[] {
  return rules
    .filter((rule) => rule.paths.length > 0)
    .filter((rule) => changed.some((path) => pathMatches(path, rule.paths)))
    .map((rule) => rule.file)
}

/**
 * One file per group, each carrying that group's own rule set.
 *
 * The directory is recreated, not merged into: a shorter changeset than last run
 * would otherwise leave a stale gNN.json behind, and a resumed workflow would
 * happily review a group that is no longer in the plan.
 */
function writeGroupFiles(groups: Group[], rules: Rule[]): void {
  rmSync(GROUP_DIR, { recursive: true, force: true })
  mkdirSync(GROUP_DIR, { recursive: true })

  groups.forEach((group) => {
    const groupFile: GroupFile = { ...group, ruleFiles: matchingRuleFiles(rules, group.files) }
    writeFileSync(`${GROUP_DIR}/${group.id}.json`, `${JSON.stringify(groupFile, null, 2)}\n`)
  })
}

function main(): void {
  process.chdir(repoRoot())

  const rules = readRules()
  const { all, generated, handWritten } = classifyChangeset(rules)

  // A deleted file is a real change — it can break every caller — but it cannot
  // be read, so it cannot be grouped. Carry it explicitly rather than dropping
  // it: a silent omission here is the class of bug this rework exists to kill.
  const deleted = handWritten.filter((path) => !existsSync(path))
  const present = handWritten.filter((path) => existsSync(path))
  const notLensed = present.filter((path) => !isLensAuditable(path))
  const reviewable = present.filter((path) => isLensAuditable(path))

  // buildGroups sets each group's units by LOC; applyStackTier then forces
  // deprioritized-stack groups (src/) to the merged unit before the quick-tier
  // check, which may merge everything anyway on a small changeset.
  const built = applyStackTier(buildGroups(reviewable))
  const quickTier = isQuickTier(built.length)
  // Same GroupFile shape either way, so the workflow and the group-file reader
  // need no branch for it. The workflow is told via `quickTier` in the plan, not
  // re-derived from group count, so the two can never disagree about whether
  // Verify runs.
  const groups = applyQuickTier(built, quickTier)
  const changesetLenses = LENSES.filter((lens) => lens.scope === 'changeset')

  writeGroupFiles(groups, rules)

  const groupFinderAgents = groups.reduce((sum, group) => sum + group.units.length, 0)
  const mergedGroups = groups.filter((group) => group.units.length === MERGED_GROUP_UNITS.length).length

  const plan: Plan = {
    groups,
    lenses: LENSES,
    groupDir: GROUP_DIR,
    ruleFiles: matchingRuleFiles(rules, all),
    generated,
    deleted,
    notLensed,
    totals: {
      files: reviewable.length,
      loc: groups.reduce((sum, group) => sum + group.loc, 0),
      groups: groups.length,
      finderAgents: groupFinderAgents + changesetLenses.length,
    },
    quickTier,
  }

  const outFlag = process.argv.indexOf('--out')
  const outPath = outFlag === -1 || outFlag + 1 >= process.argv.length ? '.cleanup-plan.json' : process.argv[outFlag + 1]
  writeFileSync(outPath, `${JSON.stringify(plan, null, 2)}\n`)

  const units = GROUP_UNITS.map((unit) => unit.id).join(' + ')
  const mergedUnits = MERGED_GROUP_UNITS.map((unit) => unit.id).join(' + ')

  // stdout is what the skill reads. Neither the plan nor the group files are ever
  // read by the skill itself, so no filename passes through the model.
  process.stdout.write(
    [
      '## Audit plan',
      '',
      `plan: ${outPath}`,
      `group files: ${GROUP_DIR}/gNN.json (one per group — each finder reads only its own)`,
      `groups: ${plan.totals.groups} (~${GROUP_LOC_BUDGET} LOC each, file boundaries, one directory per group)`,
      `files: ${plan.totals.files} lens-audited source, ${plan.totals.loc} LOC`,
      `generated (hand-edit check only): ${generated.length}`,
      `not lensed (assets/docs/config — listed in scope, no lens applies): ${notLensed.length}`,
      `deleted (unreadable — review callers): ${deleted.length}`,
      quickTier
        ? `QUICK TIER: ${plan.totals.groups} groups (<= ${QUICK_TIER_GROUP_THRESHOLD}) — every group forced to its merged unit (${MERGED_GROUP_UNITS.map((u) => u.id).join(' + ')}), Verify refutation skipped. Say this to the user before fanning out; the report must state it too.`
        : `finder agents: ${plan.totals.finderAgents} = ${plan.totals.groups - mergedGroups} groups x ${GROUP_UNITS.length} units (${units}) + ${mergedGroups} merged group(s) (small <=${MERGE_UNITS_LOC_BUDGET} LOC, or src/ maintenance-only) x ${MERGED_GROUP_UNITS.length} unit (${mergedUnits}) + ${changesetLenses.length} changeset-wide`,
      ...(quickTier ? [`finder agents: ${plan.totals.finderAgents}`] : []),
      '',
    ].join('\n'),
  )
}

// Guarded so globcheck.ts can import the pure functions above (unitsFor,
// isQuickTier, applyQuickTier) for pinning tests without triggering a real
// plan-build (writing .cleanup-groups/, .cleanup-plan.json) as an import
// side effect.
if (import.meta.main) main()
