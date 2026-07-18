/**
 * Rule frontmatter and the changeset — the two inputs every cleanup mode needs.
 *
 * The mapping from changed paths to rule files is derived from each rule file's
 * own `paths:` frontmatter rather than tabulated in SKILL.md. Why: ../../DESIGN.md.
 *
 * Runs on bare `node` with no dependencies. See typescript-standards.md.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { matchesGlob } from 'node:path'

export interface Rule {
  /** Repo-relative path to the rule file, e.g. `.agents/rules/web-architecture.md`. */
  file: string
  /** `paths:` — the only field Claude Code scopes on. Empty means load-at-launch. */
  paths: string[]
  /** `generated:` — this repo's key; artifacts excluded from a lens audit. */
  generated: string[]
  /** `trigger:` — Antigravity's field. Cross-checked, never keyed on. */
  trigger: string | null
  /** Raw body, for the prose cross-checks. */
  body: string
}

export interface Changeset {
  /** Every changed file, as a real file path. Never a directory. */
  all: string[]
  /** Rule-declared generated artifacts. Hand-edit check only, never audited. */
  generated: string[]
  /** Everything else — the actual audit scope. */
  handWritten: string[]
}

const RULES_DIR = '.agents/rules'

/**
 * Paths the cleanup skill never lens-audits or lists in scope, regardless of
 * mode. context/ is the project's own migration/history/feature bookkeeping —
 * the housekeeping checks READ it (history order, feature alignment), but it is
 * never a review target. Filtered here, downstream of changedFiles(), so the
 * "changeset matches git" pin test on changedFiles() stays exact.
 */
export const IGNORED_PREFIXES = ['context/']

export function isIgnored(path: string): boolean {
  return IGNORED_PREFIXES.some((prefix) => path.startsWith(prefix))
}

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

export function repoRoot(): string {
  return git('rev-parse', '--show-toplevel').trim()
}

/**
 * Read one list-valued key out of a rule's YAML frontmatter.
 *
 * Deliberately not a YAML library — see ../../DESIGN.md. This reads only the
 * subset this repo authors: `key:` followed by `  - "value"` lines, plus the
 * inline `["a","b"]` form. Anything richer is out of contract; keep rule
 * frontmatter in this shape.
 */
export function frontmatterList(source: string, key: string): string[] {
  const fm = frontmatter(source)
  if (fm === null) return []

  const lines = fm.split('\n')
  const start = lines.findIndex((line) => line.startsWith(`${key}:`))
  if (start === -1) return []

  // Inline form: `globs: ["backend/**/*.go"]` — go-coding-standards.md uses it.
  const inline = lines[start].slice(key.length + 1).trim()
  if (inline.startsWith('[')) {
    return inline
      .slice(1, -1)
      .split(',')
      .map((v) => unquote(v))
      .filter((v) => v.length > 0)
  }

  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^[a-z_]+:/.test(line)) break // next key ends the list
    const item = line.match(/^\s*-\s+(.*)$/)
    if (item) items.push(unquote(item[1]))
  }
  return items
}

export function frontmatterScalar(source: string, key: string): string | null {
  const fm = frontmatter(source)
  if (fm === null) return null
  const line = fm.split('\n').find((l) => l.startsWith(`${key}:`))
  return line ? unquote(line.slice(key.length + 1)) : null
}

function frontmatter(source: string): string | null {
  if (!source.startsWith('---\n')) return null
  const end = source.indexOf('\n---', 3)
  return end === -1 ? null : source.slice(4, end)
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '')
}

export function readRules(): Rule[] {
  return readdirSync(RULES_DIR)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => {
      const file = `${RULES_DIR}/${name}`
      const source = readFileSync(file, 'utf8')
      return {
        file,
        paths: frontmatterList(source, 'paths'),
        generated: frontmatterList(source, 'generated'),
        trigger: frontmatterScalar(source, 'trigger'),
        body: source,
      }
    })
}

/** `node:path`'s built-in, not a hand-rolled glob→regex engine — see ../../DESIGN.md. */
export function pathMatches(path: string, globs: string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob))
}

/**
 * The changeset, as real files — never directories.
 *
 * Deliberately not `git status --porcelain`, which collapses a fully-untracked
 * directory into one entry and breaks both coverage and rule resolution; see
 * ../../DESIGN.md. `-z` keeps paths with spaces or quotes intact.
 */
export function changedFiles(): string[] {
  const tracked = git('diff', '--name-only', '-z', 'HEAD')
  const untracked = git('ls-files', '--others', '--exclude-standard', '-z')
  const paths = `${tracked}${untracked}`.split('\0').filter((p) => p.length > 0)
  return [...new Set(paths)].sort()
}

export function classifyChangeset(rules: Rule[]): Changeset {
  const generatedGlobs = rules.flatMap((rule) => rule.generated)
  const all = changedFiles().filter((path) => !isIgnored(path))
  return {
    all,
    generated: all.filter((path) => pathMatches(path, generatedGlobs)),
    handWritten: all.filter((path) => !pathMatches(path, generatedGlobs)),
  }
}

/** Line count, or 0 for a deleted file or a non-file (untracked symlinks exist). */
export function lineCount(path: string): number {
  try {
    if (!statSync(path).isFile()) return 0
    const content = readFileSync(path, 'utf8')
    if (content.length === 0) return 0
    // A trailing newline terminates the last line rather than starting a new one, so it must not
    // add to the count — a standard newline-terminated file would otherwise read one line high.
    return content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
  } catch {
    return 0
  }
}
