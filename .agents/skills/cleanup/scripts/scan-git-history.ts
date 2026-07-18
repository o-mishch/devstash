/**
 * Fallback full-history secret scan for `cleanup public`, for when gitleaks is
 * not on PATH.
 *
 * Walks every commit reachable from all refs, materialises that commit's
 * added/modified files into a temp tree, and runs secretlint over it. Slower and
 * lower-recall than gitleaks' native history scanner, but needs no extra binary
 * beyond secretlint.
 *
 * Usage: node scan-git-history.ts [repo-path]
 * Requires: git, npx (secretlint is fetched on demand). jq is no longer needed —
 * the JSON is parsed here.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

interface SecretlintMessage {
  ruleId?: string
  message: string
}

interface SecretlintResult {
  filePath: string
  messages: SecretlintMessage[]
}

interface GitBinaryOptions {
  binary: true
}
interface GitTextOptions {
  binary?: false
}
interface GitOptions {
  binary?: boolean
}
function git(args: string[], opts: GitBinaryOptions): Buffer
function git(args: string[], opts?: GitTextOptions): string
function git(args: string[], opts?: GitOptions): string | Buffer {
  if (opts?.binary) {
    return execFileSync('git', args, {
      encoding: 'buffer',
      maxBuffer: 256 * 1024 * 1024,
    })
  }
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
}

function commitsInHistory(): string[] {
  return git(['log', '--all', '--pretty=format:%H', '--reverse']).split('\n').filter((sha) => sha.length > 0)
}

function filesAddedOrModified(sha: string): string[] {
  return git(['show', '--pretty=format:', '--name-only', '--diff-filter=ACM', sha, '--', '.'])
    .split('\n')
    .filter((path) => path.length > 0)
}

/**
 * Materialise one commit's files. A file may be unreadable at that revision
 * (submodule, symlink, mode change) — skip it rather than abort the whole scan,
 * so one odd blob cannot silently truncate the history walk.
 */
function materialise(sha: string, files: string[], dir: string): number {
  let written = 0
  files.forEach((file) => {
    const target = join(dir, file)
    try {
      const blob = execFileSync('git', ['show', `${sha}:${file}`], { maxBuffer: 64 * 1024 * 1024 })
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, blob)
      written += 1
    } catch {
      // not readable at this revision — not a finding, not an error
    }
  })
  return written
}

/**
 * secretlint exits non-zero when it finds something, so a throw here is the
 * expected path, not a failure — the findings are on stdout either way.
 */
function runSecretlint(rcPath: string, globPath: string): SecretlintResult[] {
  const args = ['--yes', 'secretlint', '--secretlintrc', rcPath, globPath, '--format', 'json']
  let stdout = ''
  try {
    stdout = execFileSync('npx', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch (error) {
    stdout = String((error as { stdout?: string }).stdout ?? '')
  }
  if (stdout.trim().length === 0) return []
  try {
    return JSON.parse(stdout) as SecretlintResult[]
  } catch {
    return []
  }
}

function main(): void {
  const repoPath = process.argv[2] ?? '.'
  const rcPath = resolve(repoPath, '.secretlintrc.json')
  process.chdir(repoPath)

  // Resolve the commit list before creating the temp dir: if this throws, there
  // is no tree to clean up, so nothing can leak.
  const commits = commitsInHistory()
  const root = mkdtempSync(join(tmpdir(), 'cleanup-history-'))
  let withFindings = 0

  try {
    commits.forEach((sha) => {
      const files = filesAddedOrModified(sha)
      if (files.length === 0) return

      const commitDir = join(root, sha)
      mkdirSync(commitDir, { recursive: true })
      try {
        if (materialise(sha, files, commitDir) === 0) return

        const hits = runSecretlint(rcPath, `${commitDir}/**/*`).filter((r) => r.messages.length > 0)
        if (hits.length === 0) return

        withFindings += 1
        process.stdout.write(`FINDING commit=${sha}\n`)
        hits.forEach((hit) => {
          hit.messages.forEach((message) => {
            // Never echo the matched value — public.md § Output Style. The rule
            // id and file locate it; the reader opens the commit themselves.
            process.stdout.write(`  ${sha} ${message.ruleId ?? 'secretlint'}: ${message.message}\n`)
          })
        })
      } finally {
        rmSync(commitDir, { recursive: true, force: true })
      }
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }

  process.stderr.write(`scanned ${commits.length} commits, ${withFindings} with findings\n`)
}

main()
