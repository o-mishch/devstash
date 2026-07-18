/**
 * Resolve the changeset and the exact rule files a cleanup run must read.
 *
 * Usage: node resolve-context.ts <check|run|improve|public>
 *
 * Output is injected into SKILL.md via `!` and is the only thing ever read —
 * this source is not context. It therefore prints a summary and writes the file
 * list to CHANGESET_FILE instead of dumping it: the dump was ~2.7k tokens on
 * every run of every mode, and improve (which enumerates its own groups) and
 * public (which scans the whole repo) never read it. See ../DESIGN.md.
 */

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { classifyChangeset, lineCount, pathMatches, readRules, repoRoot, type Rule } from './lib/rules.ts'

type Mode = 'check' | 'run' | 'improve' | 'public'

const MODES: Mode[] = ['check', 'run', 'improve', 'public']

/** The full file list, on disk. Read it only when the filenames themselves matter. */
const CHANGESET_FILE = '.cleanup-changeset.txt'

/** Areas are the first two path segments — enough to locate work, short enough to print. */
const AREA_DEPTH = 2

function isMode(value: string): value is Mode {
  return (MODES as string[]).includes(value)
}

const out: string[] = []
const say = (line = ''): void => void out.push(line)

function main(): void {
  const mode = process.argv[2] ?? ''

  if (!isMode(mode)) {
    say('## No mode')
    say(
      mode === ''
        ? 'No mode supplied. Show the Usage table and stop.'
        : `Unrecognized mode '${mode}'. Show the Usage table and stop.`,
    )
    return
  }

  process.chdir(repoRoot())
  const rules = readRules()
  const changeset = classifyChangeset(rules)

  if (changeset.all.length === 0) {
    say('## Changeset (0 files)')
    say('(none — no uncommitted work)')
    say()
    say('## Rule files to read')
    say('(none)')
    return
  }

  const { all, generated, handWritten } = changeset
  writeChangesetFile(handWritten, generated)

  say(`## Changeset (${all.length} files — ${handWritten.length} hand-written, ${generated.length} generated)`)
  say(`Full file list: \`${CHANGESET_FILE}\` — read it only if you need the filenames themselves.`)
  say()
  reportAreas(handWritten)

  if (generated.length > 0) {
    // Generated files are rule-declared artifacts: they get a regenerate-and-diff
    // hand-edit check, never a lens audit. Counted here, named in CHANGESET_FILE.
    say(`## Generated — do NOT audit, hand-edit check only (${generated.length} files)`)
    say("Rule-declared via a `generated:` frontmatter key; see each rule's generated-files section.")
    say(`Named under "# generated" in \`${CHANGESET_FILE}\`.`)
    say()
  }

  if (mode === 'improve') reportLoc(handWritten)
  reportRules(rules, all)
  reportWarnings(rules)
}

function writeChangesetFile(handWritten: string[], generated: string[]): void {
  writeFileSync(
    CHANGESET_FILE,
    [
      '# hand-written',
      ...handWritten,
      ...(generated.length > 0 ? ['', '# generated — hand-edit check only, never a lens audit', ...generated] : []),
      '',
    ].join('\n'),
  )
}

function areaOf(path: string): string {
  const parts = path.split('/')
  return parts.length <= AREA_DEPTH ? (parts.slice(0, -1).join('/') || '.') : parts.slice(0, AREA_DEPTH).join('/')
}

/** A count per area — what the dumped list was actually being read for. */
function reportAreas(handWritten: string[]): void {
  const counts = new Map<string, number>()
  handWritten.forEach((path) => {
    const area = areaOf(path)
    counts.set(area, (counts.get(area) ?? 0) + 1)
  })

  say('## Hand-written by area')
  ;[...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .forEach(([area, count]) => say(`${count.toString().padStart(4)}  ${area}`))
  say()
}

function reportLoc(handWritten: string[]): void {
  say('## LOC changed')
  say(execFileSync('git', ['diff', '--shortstat', 'HEAD'], { encoding: 'utf8' }).trim())

  // The audit's real size, and what plan-improve.ts budgets against. This and
  // the gross number diverge sharply — generated artifacts were a third of this
  // repo's untracked lines, so the gross number overstates the review by ~50%.
  const loc = handWritten.reduce((sum, path) => sum + lineCount(path), 0)
  say(`hand-written (audit scope): ${loc} lines across ${handWritten.length} files`)
  say()
}

function reportRules(rules: Rule[], changed: string[]): void {
  say('## Rule files to read')
  const scoped = rules.filter((rule) => rule.paths.length > 0)
  const matched = scoped.filter((rule) => changed.some((path) => pathMatches(path, rule.paths)))
  if (matched.length === 0) say('(none — no changed path matches any path-scoped rule)')
  matched.forEach((rule) => say(rule.file))

  say()
  say('## Already in context — do NOT read these (no paths: frontmatter, so they load at launch)')
  rules.filter((rule) => rule.paths.length === 0).forEach((rule) => say(rule.file))
  say('context/current-feature.md')
}

/**
 * Maintainer cross-checks. Both surface drift that would otherwise be invisible:
 * the audit still runs, still reports, and simply never applies a rule. Why each
 * one exists: ../DESIGN.md.
 */
function reportWarnings(rules: Rule[]): void {
  const warnings: string[] = []

  // `trigger:` is Antigravity's, inferred and unverified; `paths:` is what
  // Claude Code actually scopes on.
  rules.forEach((rule) => {
    const want = rule.paths.length > 0 ? 'glob' : 'always_on'
    if (rule.trigger !== null && rule.trigger !== want) {
      warnings.push(`${rule.file}: trigger: ${rule.trigger} but paths: implies ${want} — keys are out of sync`)
    }
  })

  // A rule that says "never hand-edit this" but never declared which paths it
  // means. Reported, never guessed at: inferring the paths from the prose is
  // exactly the drift the key removes.
  rules.forEach((rule) => {
    if (rule.generated.length > 0) return
    if (!/never hand-edit|regenerate|auto-generated/i.test(rule.body)) return
    warnings.push(
      `${rule.file}: mentions generated artifacts but declares no generated: key — its generated files will be audited as hand-written`,
    )
  })

  if (warnings.length === 0) return
  say()
  say('## Frontmatter warnings')
  warnings.forEach((warning) => say(warning))
}

/**
 * The output contract, enforced rather than asserted: always exit 0, always write
 * something, and turn a crash into a legible instruction instead of a stack trace
 * nobody sees. Why silence is the worst available failure here: ../DESIGN.md.
 */
try {
  main()
} catch (error) {
  out.length = 0
  say('## Cannot resolve context')
  say(`\`resolve-context.ts ${process.argv[2] ?? ''}\` failed: ${String(error).split('\n')[0]}`)
  say('')
  say('Nothing below is trustworthy — the changeset and the rule list are both unknown.')
  say('Tell the user this scan cannot run, and why. Do not fall back to `git status`,')
  say('and do not audit an unknown changeset: a partial scan reported as a clean one')
  say('is the failure this skill exists to prevent.')
}

process.stdout.write(`${out.join('\n')}\n`)
