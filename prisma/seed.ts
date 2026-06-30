import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '../src/generated/prisma/client'
import { ContentType } from '../src/generated/prisma'
import type { SqlDriverAdapterFactory } from '@prisma/client/runtime/client'
import { resolveDbSsl } from '../src/lib/utils/db-ssl'

// Branch-isolated DB adapter: production/Neon seeding uses @prisma/adapter-neon;
// any node-postgres target (DB_DRIVER='pg') seeds over TCP via @prisma/adapter-pg — both
// local-run (kind, plain Postgres) AND the GCP overlay (managed Cloud SQL, TLS), since
// the Neon serverless driver can't handshake either plain connection. Each adapter is
// loaded with a DYNAMIC import on its own branch so the OTHER branch's package is
// never parsed/loaded — keeping the Vercel/Neon path free of the local-only pg deps
// (mirrors the dynamic-import pattern in src/lib/infra/email-local.ts).
async function createAdapter(): Promise<SqlDriverAdapterFactory> {
  const connectionString = process.env.DIRECT_URL
  if (process.env.DB_DRIVER === 'pg') {
    const { PrismaPg } = await import('@prisma/adapter-pg')
    // Explicit node-postgres TLS via the shared resolveDbSsl (src/lib/utils/db-ssl.ts) — the
    // same policy the app's runtime adapter (src/lib/infra/db-local.ts) uses, lifted into a
    // client-safe util precisely so this standalone seed can reuse it (db-local.ts itself is
    // `import 'server-only'` and can't load here). The full verify-full rationale lives in
    // db-ssl.ts; what's seed-specific: DIRECT_URL uses sslmode=require against Cloud SQL's
    // PRIVATE IP, which Prisma 7's pg bundle now treats as verify-full and fails (P1011
    // TlsConnectionError, prisma/prisma#29060). The explicit `ssl` overrides that. Do NOT drop
    // back to `{ connectionString }`, and do NOT "fix" it by editing sslmode in DIRECT_URL —
    // the URL is Terraform-generated (modules/cloudsql) and require is correct.
    const ssl = resolveDbSsl(process.env.DATABASE_CA_CERT)
    return new PrismaPg({ connectionString, ssl })
  }
  const { PrismaNeon } = await import('@prisma/adapter-neon')
  return new PrismaNeon({ connectionString })
}

const prisma = new PrismaClient({ adapter: await createAdapter() })

// run.sh only needs the system item types (so the app can create items) — not the
// demo user or the 70k bulk load-test rows. SEED_ITEM_TYPES_ONLY=1 stops after them.
const itemTypesOnly = process.env.SEED_ITEM_TYPES_ONLY === '1'

const BULK_COUNT = 10_000
const BATCH_SIZE = 1_000
const BULK_PREFIX = '[bulk]'

const systemItemTypes = [
  { name: 'snippet', icon: 'Code', color: '#3b82f6', isSystem: true },
  { name: 'prompt', icon: 'MessageSquare', color: '#8b5cf6', isSystem: true },
  { name: 'command', icon: 'Terminal', color: '#f97316', isSystem: true },
  { name: 'note', icon: 'StickyNote', color: '#fde047', isSystem: true },
  { name: 'file', icon: 'File', color: '#6b7280', isSystem: true },
  { name: 'image', icon: 'Image', color: '#ec4899', isSystem: true },
  { name: 'link', icon: 'Link', color: '#10b981', isSystem: true },
]

// ── Vocabulary pools for creative generation ───────────────────────

const SNIPPET_TOPICS = [
  'Rate Limiter', 'LRU Cache', 'Event Emitter', 'Circuit Breaker', 'Retry with Backoff',
  'Debounce & Throttle', 'Deep Clone', 'Memoization', 'Observer Pattern', 'Pub/Sub Bus',
  'Dependency Injection', 'Command Queue', 'Binary Search', 'Trie Data Structure', 'Bloom Filter',
  'Token Bucket', 'Sliding Window Counter', 'Priority Queue', 'Union-Find', 'Segment Tree',
  'Middleware Chain', 'Promise Pool', 'Async Semaphore', 'Task Scheduler', 'State Machine',
  'Lazy Iterator', 'Cursor Pagination', 'GraphQL Resolver', 'WebSocket Manager', 'SSE Stream',
  'JWT Validator', 'HMAC Signer', 'AES Encryptor', 'Base64 Codec', 'UUID Generator',
  'Color Converter', 'Date Range Parser', 'CSV Parser', 'Markdown Renderer', 'Template Engine',
  'Feature Flag Client', 'A/B Test Router', 'Analytics Batcher', 'Error Boundary', 'Crash Reporter',
]

const SNIPPET_LANGUAGES = [
  'typescript', 'python', 'rust', 'go', 'java', 'kotlin', 'swift',
  'ruby', 'php', 'cpp', 'bash', 'sql', 'dockerfile', 'yaml',
]

const PROMPT_TOPICS = [
  'Code Review', 'Bug Analysis', 'Architecture Design', 'Performance Audit', 'Security Review',
  'API Documentation', 'Test Generation', 'Refactoring Plan', 'Dependency Upgrade', 'Database Schema Design',
  'UI Component Spec', 'Error Message Rewriter', 'Git Commit Message', 'PR Description', 'Changelog Entry',
  'README Generator', 'Onboarding Guide', 'Incident Post-Mortem', 'Data Migration Plan', 'Cost Optimization',
  'Technical Debt Assessment', 'Sprint Planning', 'Feature Breakdown', 'Risk Analysis', 'Competitive Analysis',
  'User Story Generator', 'Acceptance Criteria', 'Load Test Plan', 'Monitoring Dashboard Spec', 'Runbook Generator',
]

const COMMAND_TOPICS = [
  'Database Backup', 'Log Aggregation', 'Service Health Check', 'SSL Certificate Renewal', 'DNS Lookup',
  'Port Scanner', 'Process Monitor', 'Disk Usage Analysis', 'Memory Profiler', 'Network Traffic Capture',
  'Docker Cleanup', 'Kubernetes Rollout', 'Nginx Reload', 'Redis Flush', 'PostgreSQL Vacuum',
  'Git Branch Cleanup', 'NPM Dependency Audit', 'Find Large Files', 'Compress Logs', 'Rotate Secrets',
  'Deploy to Staging', 'Smoke Test Runner', 'Database Migration', 'Cache Invalidation', 'CDN Purge',
  'AWS S3 Sync', 'EC2 Instance List', 'Lambda Deploy', 'Cloudflare DNS Update', 'Vercel Env Push',
]

const NOTE_TOPICS = [
  'System Design Interview', 'CAP Theorem', 'ACID vs BASE', 'Event Sourcing', 'CQRS Pattern',
  'Microservices vs Monolith', 'REST vs GraphQL vs gRPC', 'OAuth 2.0 Flow', 'JWT Deep Dive', 'mTLS Setup',
  'Redis Use Cases', 'PostgreSQL Indexing', 'Sharding Strategies', 'Replication Lag', 'Write-Ahead Log',
  'CDN Architecture', 'WebSocket Scaling', 'Message Queue Patterns', 'Service Mesh', 'API Gateway',
  'Observability Stack', 'SLO vs SLA vs SLI', 'Chaos Engineering', 'Blue-Green Deploy', 'Canary Release',
  'React 19 New Features', 'Next.js App Router', 'Tailwind v4 Migration', 'TypeScript 5.x Tips', 'Bun vs Node',
]

const FILE_NAMES = [
  ['architecture-diagram', 'pdf'], ['api-spec', 'pdf'], ['database-schema', 'pdf'],
  ['onboarding-guide', 'pdf'], ['runbook', 'pdf'], ['postmortem', 'pdf'],
  ['env-template', 'txt'], ['gitignore-template', 'txt'], ['editorconfig', 'txt'],
  ['docker-compose', 'yml'], ['github-workflow', 'yml'], ['k8s-deployment', 'yml'],
  ['eslint-config', 'json'], ['tsconfig-base', 'json'], ['prettier-config', 'json'],
  ['migration-001', 'sql'], ['seed-data', 'sql'], ['analytics-export', 'csv'],
  ['design-system', 'fig'], ['wireframes-v2', 'fig'],
]

const IMAGE_SUBJECTS = [
  'Dashboard UI Mockup', 'Mobile App Wireframe', 'System Architecture Diagram',
  'Database ERD', 'API Flow Chart', 'Component Library Preview',
  'Landing Page Design', 'Dark Mode Screenshot', 'Color Palette Reference',
  'Typography Scale', 'Icon Set Preview', 'Login Screen Design',
  'Onboarding Flow', 'Notification Center UI', 'Analytics Dashboard',
  'Settings Page Layout', 'Profile Page Design', 'Search Results UI',
  'Error State Design', 'Empty State Illustration',
]

const IMAGE_DIMENSIONS: [number, number][] = [
  [1920, 1080], [1280, 720], [800, 600], [1200, 630], [400, 300],
  [2560, 1440], [1024, 768], [640, 480], [1080, 1080], [1200, 900],
]

const LINK_CATEGORIES = [
  ['React Documentation', 'https://react.dev/reference/react', 'Official React API reference — hooks, components, APIs'],
  ['MDN Web Docs', 'https://developer.mozilla.org/en-US/docs/Web/API', 'Web platform APIs — DOM, Fetch, WebSockets and more'],
  ['Node.js Docs', 'https://nodejs.org/api', 'Node.js core module API documentation'],
  ['TypeScript Handbook', 'https://www.typescriptlang.org/docs/handbook', 'Official TypeScript language guide'],
  ['PostgreSQL Docs', 'https://www.postgresql.org/docs/current', 'PostgreSQL 17 full documentation'],
  ['Redis Commands', 'https://redis.io/commands', 'Complete Redis command reference'],
  ['Kubernetes Docs', 'https://kubernetes.io/docs/home', 'K8s concepts, guides, and API reference'],
  ['AWS Docs', 'https://docs.aws.amazon.com', 'Amazon Web Services documentation hub'],
  ['Cloudflare Docs', 'https://developers.cloudflare.com', 'Cloudflare Workers, R2, D1, and more'],
  ['Vercel Docs', 'https://vercel.com/docs', 'Deployment, edge functions, and storage docs'],
]

// ── Content generators ────────────────────────────────────────────

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length]
}

function generateSnippetContent(topic: string, lang: string, i: number): string {
  const templates: Record<string, (t: string, n: number) => string> = {
    typescript: (t, n) => `/**
 * ${t}
 * Utility #${n} — production-ready implementation with full error handling.
 */

interface ${t.replace(/\s+/g, '')}Options {
  maxRetries?: number
  timeoutMs?: number
  onError?: (err: Error) => void
}

interface ${t.replace(/\s+/g, '')}Result<T> {
  data: T | null
  error: Error | null
  attempts: number
  durationMs: number
}

export class ${t.replace(/\s+/g, '')} {
  private readonly options: Required<${t.replace(/\s+/g, '')}Options>
  private callCount = 0
  private errorCount = 0

  constructor(options: ${t.replace(/\s+/g, '')}Options = {}) {
    this.options = {
      maxRetries: options.maxRetries ?? 3,
      timeoutMs: options.timeoutMs ?? 5_000,
      onError: options.onError ?? ((e) => console.error('[${t}]', e)),
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<${t.replace(/\s+/g, '')}Result<T>> {
    const start = performance.now()
    this.callCount++
    let attempts = 0

    while (attempts <= this.options.maxRetries) {
      try {
        const data = await Promise.race([
          fn(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), this.options.timeoutMs),
          ),
        ])
        return { data, error: null, attempts: attempts + 1, durationMs: performance.now() - start }
      } catch (err) {
        attempts++
        this.errorCount++
        const error = err instanceof Error ? err : new Error(String(err))
        this.options.onError(error)
        if (attempts > this.options.maxRetries) {
          return { data: null, error, attempts, durationMs: performance.now() - start }
        }
        await new Promise((r) => setTimeout(r, 2 ** attempts * 100))
      }
    }

    return { data: null, error: new Error('Unreachable'), attempts, durationMs: performance.now() - start }
  }

  get stats() {
    return { calls: this.callCount, errors: this.errorCount }
  }
}

// Usage
const executor = new ${t.replace(/\s+/g, '')}({ maxRetries: 3, timeoutMs: 3_000 })
const result = await executor.execute(() => fetch('/api/data').then((r) => r.json()))
if (result.error) console.error('Failed after', result.attempts, 'attempts')
else console.log('Got data in', result.durationMs.toFixed(1), 'ms')`,

    python: (t, n) => `"""
${t} — Implementation #${n}
Production-grade utility with logging, typing, and error handling.
"""

from __future__ import annotations
import time
import logging
import functools
from typing import TypeVar, Generic, Callable, Optional, Any
from dataclasses import dataclass, field
from threading import Lock

logger = logging.getLogger(__name__)
T = TypeVar("T")


@dataclass
class Result(Generic[T]):
    data: Optional[T]
    error: Optional[Exception]
    attempts: int
    duration_ms: float

    @property
    def ok(self) -> bool:
        return self.error is None


class ${t.replace(/\s+/g, '')}:
    """${t} with configurable retry, timeout, and metrics."""

    def __init__(
        self,
        max_retries: int = 3,
        timeout_ms: float = 5_000,
        backoff_base: float = 2.0,
    ) -> None:
        self.max_retries = max_retries
        self.timeout_s = timeout_ms / 1_000
        self.backoff_base = backoff_base
        self._lock = Lock()
        self._call_count = 0
        self._error_count = 0

    def execute(self, fn: Callable[[], T], *args: Any, **kwargs: Any) -> Result[T]:
        start = time.perf_counter()
        with self._lock:
            self._call_count += 1

        for attempt in range(self.max_retries + 1):
            try:
                data = fn(*args, **kwargs)
                duration = (time.perf_counter() - start) * 1_000
                logger.info("${t} succeeded in %.1fms after %d attempt(s)", duration, attempt + 1)
                return Result(data=data, error=None, attempts=attempt + 1, duration_ms=duration)
            except Exception as exc:  # noqa: BLE001
                with self._lock:
                    self._error_count += 1
                logger.warning("${t} attempt %d/%d failed: %s", attempt + 1, self.max_retries + 1, exc)
                if attempt < self.max_retries:
                    time.sleep(self.backoff_base ** attempt * 0.1)

        duration = (time.perf_counter() - start) * 1_000
        return Result(data=None, error=RuntimeError("Max retries exceeded"), attempts=self.max_retries + 1, duration_ms=duration)

    @property
    def stats(self) -> dict[str, int]:
        with self._lock:
            return {"calls": self._call_count, "errors": self._error_count}


# Usage
executor = ${t.replace(/\s+/g, '')}(max_retries=3, timeout_ms=3_000)
result = executor.execute(lambda: {"status": "ok", "id": ${n}})
if result.ok:
    print(f"Success in {result.duration_ms:.1f}ms:", result.data)
`,

    go: (t, n) => `// Package util provides ${t} — implementation #${n}.
package util

import (
\t"context"
\t"errors"
\t"fmt"
\t"log/slog"
\t"math"
\t"sync"
\t"sync/atomic"
\t"time"
)

// ${t.replace(/\s+/g, '')}Config holds configuration for the ${t}.
type ${t.replace(/\s+/g, '')}Config struct {
\tMaxRetries int
\tTimeout    time.Duration
\tBaseDelay  time.Duration
}

// Default${t.replace(/\s+/g, '')}Config returns sane defaults.
func Default${t.replace(/\s+/g, '')}Config() ${t.replace(/\s+/g, '')}Config {
\treturn ${t.replace(/\s+/g, '')}Config{
\t\tMaxRetries: 3,
\t\tTimeout:    5 * time.Second,
\t\tBaseDelay:  100 * time.Millisecond,
\t}
}

// Result wraps execution outcome.
type Result[T any] struct {
\tData     T
\tErr      error
\tAttempts int
\tDuration time.Duration
}

// ${t.replace(/\s+/g, '')} executes functions with retry, timeout, and telemetry.
type ${t.replace(/\s+/g, '')} struct {
\tcfg      ${t.replace(/\s+/g, '')}Config
\tcalls    atomic.Int64
\terrors   atomic.Int64
\tmu       sync.Mutex
}

// New${t.replace(/\s+/g, '')} creates a new instance with the given config.
func New${t.replace(/\s+/g, '')}(cfg ${t.replace(/\s+/g, '')}Config) *${t.replace(/\s+/g, '')} {
\treturn &${t.replace(/\s+/g, '')}{cfg: cfg}
}

// Execute runs fn with retries and timeout, returning a typed Result.
func Execute[T any](ctx context.Context, e *${t.replace(/\s+/g, '')}, fn func(context.Context) (T, error)) Result[T] {
\tstart := time.Now()
\te.calls.Add(1)
\tvar zero T

\tfor attempt := 0; attempt <= e.cfg.MaxRetries; attempt++ {
\t\ttCtx, cancel := context.WithTimeout(ctx, e.cfg.Timeout)
\t\tdata, err := fn(tCtx)
\t\tcancel()

\t\tif err == nil {
\t\t\tslog.Info("${t} succeeded", "attempt", attempt+1, "duration", time.Since(start))
\t\t\treturn Result[T]{Data: data, Attempts: attempt + 1, Duration: time.Since(start)}
\t\t}

\t\te.errors.Add(1)
\t\tslog.Warn("${t} attempt failed", "attempt", attempt+1, "err", err)

\t\tif attempt < e.cfg.MaxRetries && !errors.Is(err, context.Canceled) {
\t\t\tdelay := time.Duration(math.Pow(2, float64(attempt))) * e.cfg.BaseDelay
\t\t\tselect {
\t\t\tcase <-time.After(delay):
\t\t\tcase <-ctx.Done():
\t\t\t\treturn Result[T]{Data: zero, Err: ctx.Err(), Attempts: attempt + 1, Duration: time.Since(start)}
\t\t\t}
\t\t}

\t\tif attempt == e.cfg.MaxRetries {
\t\t\treturn Result[T]{Data: zero, Err: fmt.Errorf("max retries exceeded: %w", err), Attempts: attempt + 1, Duration: time.Since(start)}
\t\t}
\t}
\treturn Result[T]{Data: zero, Err: errors.New("unreachable"), Attempts: 0}
}`,
  }

  const template = templates[lang] ?? templates['typescript']
  return template(topic, i)
}

function generatePromptContent(topic: string, i: number): string {
  return `# ${topic} — Prompt v${Math.floor(i / 10) + 1}.${i % 10}

## Role
You are a senior software engineer and technical architect with 10+ years of experience building production systems at scale. You excel at ${topic.toLowerCase()} and communicate with clarity, precision, and pragmatism.

## Context
The user will provide you with code, system descriptions, or technical problems. Your job is to perform a thorough **${topic}** and return structured, actionable output.

## Instructions

1. **Understand the scope** — Read the full input before responding. Ask clarifying questions if critical context is missing.
2. **Be systematic** — Cover all relevant dimensions: correctness, performance, security, maintainability, and scalability.
3. **Prioritize ruthlessly** — Lead with critical issues. Do not bury blockers under minor style notes.
4. **Be specific** — Cite line numbers, function names, or exact patterns when referencing the input.
5. **Suggest, don't dictate** — Provide concrete alternatives, not vague advice like "make it cleaner."
6. **Consider trade-offs** — Every recommendation should acknowledge the cost vs. benefit.
7. **Match the stack** — Tailor suggestions to the language, framework, and constraints visible in the input.

## Output Format

Return your response in the following structure:

### Summary
One paragraph — overall assessment, severity of issues found, and recommended next step.

### Critical Issues
Numbered list of blockers (correctness bugs, security holes, data loss risks). Each item:
- **What**: Describe the issue precisely
- **Where**: Reference the specific code location
- **Why it matters**: Explain the impact
- **Fix**: Provide a concrete corrected snippet or approach

### Major Issues
Same format as Critical, for non-blocking but significant problems (performance, scalability, maintainability).

### Minor Notes
Bullet list of small improvements (naming, style, dead code).

### Recommended Next Steps
Ordered action plan (1–5 steps) with estimated effort per step.

---

## Input

\`\`\`
{{paste_your_input_here}}
\`\`\`

---

*Prompt #${i} — Optimized for: ${topic}*
*Temperature: 0.3 | Top-p: 0.9 | Max tokens: 4096*`
}

function generateCommandContent(topic: string, i: number): string {
  const scripts = [
    `#!/usr/bin/env bash
# ${topic} — Script #${i}
# Usage: ./${topic.toLowerCase().replace(/\s+/g, '-')}.sh [--dry-run] [--verbose]
set -euo pipefail

DRY_RUN=false
VERBOSE=false
LOG_FILE="/var/log/${topic.toLowerCase().replace(/\s+/g, '-')}.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
die() { log "ERROR: $*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --verbose) VERBOSE=true ;;
    *) die "Unknown flag: $1" ;;
  esac
  shift
done

log "Starting ${topic}..."
[[ "$DRY_RUN" == true ]] && log "DRY RUN — no changes will be made"

# Pre-flight checks
command -v jq >/dev/null 2>&1 || die "jq is required but not installed"
command -v curl >/dev/null 2>&1 || die "curl is required but not installed"
[[ -n "\${DATABASE_URL:-}" ]] || die "DATABASE_URL environment variable is not set"

# Main logic
run() {
  local cmd="$*"
  if [[ "$VERBOSE" == true ]]; then log "RUN: $cmd"; fi
  if [[ "$DRY_RUN" == false ]]; then eval "$cmd" || die "Command failed: $cmd"; fi
}

run "echo 'Executing ${topic} step 1...'"
run "sleep 0.1"
run "echo 'Executing ${topic} step 2...'"

RESULT=$(curl -sf "\${API_URL:-http://localhost:3000}/health" 2>/dev/null || echo '{"status":"unknown"}')
STATUS=$(echo "$RESULT" | jq -r '.status // "error"')

if [[ "$STATUS" != "ok" ]]; then
  die "Health check failed: status=$STATUS"
fi

log "${topic} completed successfully."`,

    `# ${topic} — One-liner collection #${i}
# Copy individual commands or source this file.

# ── Core operation ────────────────────────────────────────────────
${topic.toLowerCase().replace(/\s+/g, '-')} \\
  --config ./config.yaml \\
  --output ./output \\
  --log-level info \\
  --timeout 30 \\
  --retry 3

# ── Dry run (preview only) ────────────────────────────────────────
${topic.toLowerCase().replace(/\s+/g, '-')} --dry-run --verbose 2>&1 | tee /tmp/dry-run-${i}.log

# ── With environment overrides ────────────────────────────────────
DATABASE_URL="$PROD_DB" \\
API_KEY="$SECRET_KEY" \\
NODE_ENV=production \\
  ${topic.toLowerCase().replace(/\s+/g, '-')} --env production

# ── Pipe to JSON formatter ────────────────────────────────────────
${topic.toLowerCase().replace(/\s+/g, '-')} --format json | jq '.results[] | select(.status == "error")'

# ── Watch mode (re-run on file change) ────────────────────────────
fswatch -o ./config | xargs -n1 -I{} sh -c '${topic.toLowerCase().replace(/\s+/g, '-')} --config ./config.yaml'

# ── Cron expression (run every day at 02:00) ──────────────────────
# 0 2 * * * /usr/local/bin/${topic.toLowerCase().replace(/\s+/g, '-')} >> /var/log/cron.log 2>&1`,
  ]
  return scripts[i % scripts.length]
}

function generateNoteContent(topic: string, i: number): string {
  return `# ${topic}

> Note #${i} — Last reviewed: ${new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)}

## Overview

${topic} is a foundational concept in modern software engineering. Understanding it deeply enables better architectural decisions, more resilient systems, and clearer communication with teammates.

This note captures the key mental models, trade-offs, and practical patterns I've encountered when working with ${topic}.

---

## Core Concepts

### Concept 1 — The Fundamental Problem
Every system that deals with ${topic} must answer a core question: **how do you maintain correctness under failure, load, and concurrent access?** The answer depends heavily on your consistency requirements, latency budget, and operational constraints.

Key insight: _There is no universally correct answer. Choose the approach that fits your read/write ratio, failure mode tolerance, and team's operational maturity._

### Concept 2 — The Trade-off Triangle
When working with ${topic}, you're always balancing three forces:

| Dimension | What you gain | What you give up |
|-----------|--------------|------------------|
| **Consistency** | Correctness guarantees | Availability under partition |
| **Availability** | Always responds | May serve stale data |
| **Partition Tolerance** | Survives network splits | One of the above |

In practice: pick the two that matter most for your use case.

### Concept 3 — Failure Modes
The most common failure modes when implementing ${topic}:

1. **Silent data corruption** — writes succeed but data is wrong; hard to detect without checksums or audit logs
2. **Split-brain** — two nodes believe they're the leader; leads to conflicting writes
3. **Thundering herd** — cache miss triggers N simultaneous DB queries; use probabilistic early expiry or mutex
4. **Cascading failures** — one slow dependency propagates latency across the call chain; use bulkheads and timeouts

---

## Practical Patterns

### Pattern A — The Safe Default
\`\`\`
// Always validate before mutating
// Always checkpoint before long operations
// Always log what you did, not just what failed
\`\`\`

### Pattern B — The Emergency Lever
Keep a feature flag that allows disabling ${topic} entirely with a single config change. This lets you degrade gracefully without a deploy during an incident.

### Pattern C — The Observability Checklist
Before shipping anything involving ${topic}, confirm you have:
- [ ] RED metrics: Rate, Errors, Duration
- [ ] Structured logs with correlation IDs
- [ ] An alert for error rate > 1% over 5 minutes
- [ ] A runbook linked from the alert

---

## References & Further Reading

- [Official spec / RFC](https://example.com/spec-${i}) — The authoritative source
- [Martin Fowler's write-up](https://martinfowler.com) — Accessible explanation with diagrams
- [Real-world incident analysis](https://example.com/postmortem-${i}) — What went wrong and why

---

## Open Questions

- [ ] How does this behave under a 10x traffic spike?
- [ ] What's the rollback plan if the migration fails halfway?
- [ ] Do we need multi-region support in the next 12 months?

*Tagged: #architecture #${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')} #reference*`
}

// ── Row builders ──────────────────────────────────────────────────

interface SeedItem {
  title: string
  contentType: ContentType
  content?: string
  url?: string
  description?: string
  language?: string
  isPinned?: boolean
  isFavorite?: boolean
  itemTypeId: string
  userId: string
  fileName?: string
  fileSize?: number
  fileUrl?: string
}

function buildBulkRow(typeName: string, typeId: string, userId: string, i: number): SeedItem {
  switch (typeName) {
    case 'snippet': {
      const topic = pick(SNIPPET_TOPICS, i)
      const lang = pick(SNIPPET_LANGUAGES, i + 3)
      return {
        title: `${BULK_PREFIX} ${topic}`,
        contentType: ContentType.TEXT,
        language: lang,
        description: `${topic} — reusable, production-hardened implementation in ${lang}. Covers error handling, retries, timeouts, and observability. Drop-in ready, zero external dependencies.`,
        content: generateSnippetContent(topic, lang, i),
        isFavorite: i % 13 === 0,
        isPinned: i % 47 === 0,
        itemTypeId: typeId,
        userId,
      }
    }

    case 'prompt': {
      const topic = pick(PROMPT_TOPICS, i)
      return {
        title: `${BULK_PREFIX} ${topic} Prompt`,
        contentType: ContentType.TEXT,
        description: `Optimized system prompt for ${topic}. Instructs the model to be systematic, specific, and prioritize critical issues. Includes structured output format for consistent, actionable responses.`,
        content: generatePromptContent(topic, i),
        isFavorite: i % 17 === 0,
        isPinned: i % 53 === 0,
        itemTypeId: typeId,
        userId,
      }
    }

    case 'command': {
      const topic = pick(COMMAND_TOPICS, i)
      return {
        title: `${BULK_PREFIX} ${topic}`,
        contentType: ContentType.TEXT,
        description: `${topic} — battle-tested shell script with dry-run support, structured logging, pre-flight validation, and safe error handling. Suitable for CI/CD pipelines and cron jobs.`,
        content: generateCommandContent(topic, i),
        language: 'bash',
        isFavorite: i % 19 === 0,
        isPinned: i % 61 === 0,
        itemTypeId: typeId,
        userId,
      }
    }

    case 'note': {
      const topic = pick(NOTE_TOPICS, i)
      return {
        title: `${BULK_PREFIX} ${topic}`,
        contentType: ContentType.TEXT,
        description: `Personal reference note on ${topic}. Covers core concepts, common trade-offs, practical patterns, failure modes, and curated reading links. Updated regularly as understanding deepens.`,
        content: generateNoteContent(topic, i),
        isFavorite: i % 11 === 0,
        isPinned: i % 43 === 0,
        itemTypeId: typeId,
        userId,
      }
    }

    case 'file': {
      const [baseName, ext] = pick(FILE_NAMES, i)
      const name = `${baseName}-v${Math.floor(i / FILE_NAMES.length) + 1}.${ext}`
      const sizeKb = 10 + (i % 500) * 20
      return {
        title: `${BULK_PREFIX} ${baseName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())} v${Math.floor(i / FILE_NAMES.length) + 1}`,
        contentType: ContentType.FILE,
        description: `${name} — ${ext.toUpperCase()} document. Size: ${sizeKb} KB. Auto-generated for load testing. Contains realistic metadata including version, author, and creation timestamp.`,
        fileName: name,
        fileSize: sizeKb * 1024,
        fileUrl: 'cmpk3zmxa00072jceqh45o1yo/f7feb2e9-ae51-4a70-a095-a13331b6733a.pdf',
        isFavorite: i % 23 === 0,
        isPinned: i % 67 === 0,
        itemTypeId: typeId,
        userId,
      }
    }

    case 'image': {
      const subject = pick(IMAGE_SUBJECTS, i)
      const [w, h] = pick(IMAGE_DIMENSIONS, i)
      const version = Math.floor(i / IMAGE_SUBJECTS.length) + 1
      const imageKeys = [
        { key: 'cmpk3zmxa00072jceqh45o1yo/32114d4e-6048-4bb7-8a97-e2332a303915.jpeg', ext: 'jpeg' },
        { key: 'cmpk3zmxa00072jceqh45o1yo/bb7b5d4d-49cc-4603-9c9d-b540ccc1da33.png', ext: 'png' },
        { key: 'a619936e-d734-4032-b15b-be61b3b8f926/8a27a479-9a29-4f4d-b115-375d93eae212.jpg', ext: 'jpg' },
        { key: 'cmpjykoh3000004jx6ahstbmh/9f4f472d-920a-4578-9d0a-44965de9cf41.jpg', ext: 'jpg' },
      ]
      const { key, ext } = imageKeys[i % imageKeys.length]
      const name = `${subject.toLowerCase().replace(/\s+/g, '-')}-v${version}.${ext}`
      return {
        title: `${BULK_PREFIX} ${subject} v${version}`,
        contentType: ContentType.FILE,
        description: `${subject} — ${w}×${h}px image. Version ${version}. Auto-generated for image grid load testing.`,
        fileName: name,
        fileSize: w * h * 3,
        fileUrl: key,
        isFavorite: i % 29 === 0,
        isPinned: i % 71 === 0,
        itemTypeId: typeId,
        userId,
      }
    }

    case 'link':
    default: {
      const [name, baseUrl, desc] = pick(LINK_CATEGORIES, i)
      const section = i % 50
      return {
        title: `${BULK_PREFIX} ${name} — Section ${section + 1}`,
        contentType: ContentType.URL,
        description: `${desc}. Bookmarked section ${section + 1} — contains frequently referenced material for ${name.toLowerCase()}. Part of the curated developer reference library.`,
        url: `${baseUrl}#section-${section}`,
        isFavorite: i % 31 === 0,
        isPinned: i % 73 === 0,
        itemTypeId: typeId,
        userId,
      }
    }
  }
}

// ── Bulk seeder ───────────────────────────────────────────────────

async function seedBulkType(typeName: string, typeId: string, userId: string) {
  const existing = await prisma.item.count({
    where: { userId, title: { startsWith: `${BULK_PREFIX} ` }, itemTypeId: typeId },
  })

  if (existing >= BULK_COUNT) {
    console.log(`  ${typeName}: already at ${existing}, skipping`)
    return
  }

  let inserted = existing
  const toInsert = BULK_COUNT - existing

  while (inserted < BULK_COUNT) {
    const batchEnd = Math.min(inserted + BATCH_SIZE, BULK_COUNT)
    const rows = Array.from({ length: batchEnd - inserted }, (_, j) =>
      buildBulkRow(typeName, typeId, userId, existing + inserted + j),
    )
    await prisma.item.createMany({ data: rows })
    inserted = batchEnd
  }

  console.log(`  ${typeName}: inserted ${toInsert} items (total ${BULK_COUNT})`)
}

// ── Demo items ────────────────────────────────────────────────────

async function seedItems(items: SeedItem[], collectionId: string) {
  await Promise.all(
    items.map(async (data) => {
      let item = await prisma.item.findFirst({
        where: { title: data.title, userId: data.userId },
      })
      if (!item) {
        item = await prisma.item.create({ data })
      }

      const link = await prisma.itemCollection.findUnique({
        where: { itemId_collectionId: { itemId: item.id, collectionId } },
      })
      if (!link) {
        await prisma.itemCollection.create({ data: { itemId: item.id, collectionId } })
      }
    }),
  )
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding system item types...')
  for (const type of systemItemTypes) {
    const existing = await prisma.itemType.findFirst({ where: { name: type.name, userId: null } })
    if (!existing) await prisma.itemType.create({ data: type })
  }

  if (itemTypesOnly) {
    console.log('SEED_ITEM_TYPES_ONLY=1 — done (skipping demo user and bulk data).')
    return
  }

  console.log('Seeding demo user...')
  const passwordHash = await bcrypt.hash('12345678', 12)
  const user = await prisma.user.upsert({
    where: { email: 'demo@devstash.one' },
    update: { password: passwordHash },
    create: {
      email: 'demo@devstash.one',
      name: 'Demo User',
      password: passwordHash,
      isPro: false,
      emailVerified: new Date(),
    },
  })

  const types = await prisma.itemType.findMany({ where: { isSystem: true, userId: null } })
  const t = Object.fromEntries(types.map((type) => [type.name, type.id]))

  // ── React Patterns ─────────────────────────────────────────────
  console.log('Seeding React Patterns...')
  let reactPatterns = await prisma.collection.findFirst({ where: { name: 'React Patterns', userId: user.id } })
  if (!reactPatterns) {
    reactPatterns = await prisma.collection.create({
      data: { name: 'React Patterns', description: 'Reusable React patterns and hooks', userId: user.id, isFavorite: true },
    })
  }

  await seedItems([
    {
      title: 'useDebounce Hook',
      contentType: ContentType.TEXT,
      language: 'typescript',
      isPinned: true,
      itemTypeId: t['snippet'],
      userId: user.id,
      content: `import { useState, useEffect } from 'react'

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debouncedValue
}`,
    },
    {
      title: 'Context Provider Pattern',
      contentType: ContentType.TEXT,
      language: 'typescript',
      itemTypeId: t['snippet'],
      userId: user.id,
      content: `import { createContext, useContext, useState, ReactNode } from 'react'

interface ThemeContextValue {
  theme: 'light' | 'dark'
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}`,
    },
    {
      title: 'cn Utility (clsx + tailwind-merge)',
      contentType: ContentType.TEXT,
      language: 'typescript',
      itemTypeId: t['snippet'],
      userId: user.id,
      content: `import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}`,
    },
  ], reactPatterns.id)

  // ── AI Workflows ───────────────────────────────────────────────
  console.log('Seeding AI Workflows...')
  let aiWorkflows = await prisma.collection.findFirst({ where: { name: 'AI Workflows', userId: user.id } })
  if (!aiWorkflows) {
    aiWorkflows = await prisma.collection.create({
      data: { name: 'AI Workflows', description: 'AI prompts and workflow automations', userId: user.id, isFavorite: true },
    })
  }

  await seedItems([
    {
      title: 'Code Review Prompt',
      contentType: ContentType.TEXT,
      itemTypeId: t['prompt'],
      userId: user.id,
      content: `Review the following code and provide feedback on:
1. Correctness — are there logic errors or edge cases?
2. Performance — any unnecessary operations or bottlenecks?
3. Security — input validation, auth checks, injection risks
4. Readability — naming, structure, unnecessary complexity
5. Patterns — does it match the existing codebase style?

Be concise. Prioritize issues by severity (critical → minor).

\`\`\`
{{code}}
\`\`\``,
    },
    {
      title: 'Documentation Generator',
      contentType: ContentType.TEXT,
      itemTypeId: t['prompt'],
      userId: user.id,
      content: `Generate clear, concise documentation for the following function or module.

Include:
- A one-line summary
- Parameters (name, type, description)
- Return value
- Example usage
- Any important notes or side effects

Do not add obvious comments. Focus on the WHY, not the WHAT.

\`\`\`
{{code}}
\`\`\``,
    },
    {
      title: 'Refactoring Assistant',
      contentType: ContentType.TEXT,
      itemTypeId: t['prompt'],
      userId: user.id,
      content: `Refactor the following code to improve readability and maintainability.

Rules:
- Preserve exact behavior — no functional changes
- Reduce nesting and complexity where possible
- Use descriptive variable names
- Extract repeated logic into helpers
- Remove dead code and unused variables
- Keep it idiomatic for the language/framework

Show the refactored version only. Add a brief bullet list of what changed.

\`\`\`
{{code}}
\`\`\``,
    },
  ], aiWorkflows.id)

  // ── DevOps ─────────────────────────────────────────────────────
  console.log('Seeding DevOps...')
  let devops = await prisma.collection.findFirst({ where: { name: 'DevOps', userId: user.id } })
  if (!devops) {
    devops = await prisma.collection.create({
      data: { name: 'DevOps', description: 'Infrastructure and deployment resources', userId: user.id },
    })
  }

  await seedItems([
    {
      title: 'Next.js Dockerfile (multi-stage)',
      contentType: ContentType.TEXT,
      language: 'dockerfile',
      itemTypeId: t['snippet'],
      userId: user.id,
      content: `FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]`,
    },
    {
      title: 'Zero-downtime deploy (Docker)',
      contentType: ContentType.TEXT,
      itemTypeId: t['command'],
      userId: user.id,
      content: `docker pull ghcr.io/$IMAGE_NAME:latest && \\
docker stop app || true && \\
docker rm app || true && \\
docker run -d --name app --restart unless-stopped \\
  -p 3000:3000 \\
  --env-file .env._production \\
  ghcr.io/$IMAGE_NAME:latest`,
      description: 'Pull latest image, swap container with zero downtime',
    },
    {
      title: 'GitHub Actions Documentation',
      contentType: ContentType.URL,
      url: 'https://docs.github.com/en/actions',
      description: 'Official GitHub Actions docs — workflows, triggers, runners',
      itemTypeId: t['link'],
      userId: user.id,
    },
    {
      title: 'Docker Official Documentation',
      contentType: ContentType.URL,
      url: 'https://docs.docker.com',
      description: 'Docker engine, Compose, networking, volumes reference',
      itemTypeId: t['link'],
      userId: user.id,
    },
  ], devops.id)

  // ── Terminal Commands ──────────────────────────────────────────
  console.log('Seeding Terminal Commands...')
  let terminalCmds = await prisma.collection.findFirst({ where: { name: 'Terminal Commands', userId: user.id } })
  if (!terminalCmds) {
    terminalCmds = await prisma.collection.create({
      data: { name: 'Terminal Commands', description: 'Useful shell commands for everyday development', userId: user.id },
    })
  }

  await seedItems([
    {
      title: 'Git — interactive rebase last N commits',
      contentType: ContentType.TEXT,
      itemTypeId: t['command'],
      userId: user.id,
      content: 'git rebase -i HEAD~{{n}}',
      description: 'Squash, reorder, or edit the last N commits before pushing',
    },
    {
      title: 'Docker — remove all stopped containers & unused images',
      contentType: ContentType.TEXT,
      itemTypeId: t['command'],
      userId: user.id,
      content: 'docker system prune -af --volumes',
      description: 'Frees disk space by removing stopped containers, dangling images, and unused volumes',
    },
    {
      title: 'Find & kill process on port',
      contentType: ContentType.TEXT,
      itemTypeId: t['command'],
      userId: user.id,
      isPinned: true,
      content: 'lsof -ti tcp:{{port}} | xargs kill -9',
      description: 'Useful when a dev server fails to release its port',
    },
    {
      title: 'npm — audit and fix vulnerabilities',
      contentType: ContentType.TEXT,
      itemTypeId: t['command'],
      userId: user.id,
      content: 'npm audit fix && npm dedupe',
      description: 'Auto-fix known vulnerabilities and deduplicate the dependency tree',
    },
  ], terminalCmds.id)

  // ── Design Resources ───────────────────────────────────────────
  console.log('Seeding Design Resources...')
  let designResources = await prisma.collection.findFirst({ where: { name: 'Design Resources', userId: user.id } })
  if (!designResources) {
    designResources = await prisma.collection.create({
      data: { name: 'Design Resources', description: 'UI/UX resources and references', userId: user.id },
    })
  }

  await seedItems([
    {
      title: 'Tailwind CSS Documentation',
      contentType: ContentType.URL,
      url: 'https://tailwindcss.com/docs',
      description: 'Utility-first CSS framework — full class reference',
      itemTypeId: t['link'],
      userId: user.id,
    },
    {
      title: 'shadcn/ui Components',
      contentType: ContentType.URL,
      url: 'https://ui.shadcn.com',
      description: 'Accessible, copy-paste React components built on Radix UI',
      itemTypeId: t['link'],
      userId: user.id,
    },
    {
      title: 'Radix UI Primitives',
      contentType: ContentType.URL,
      url: 'https://www.radix-ui.com/primitives',
      description: 'Unstyled, accessible component primitives for React',
      itemTypeId: t['link'],
      userId: user.id,
    },
    {
      title: 'Lucide Icons',
      contentType: ContentType.URL,
      url: 'https://lucide.dev/icons',
      description: 'Open-source icon library — searchable, MIT licensed',
      itemTypeId: t['link'],
      userId: user.id,
    },
  ], designResources.id)

  // ── Bulk load-test data (10,000 per type) ──────────────────────
  console.log(`Seeding bulk items (${BULK_COUNT.toLocaleString()} per type)...`)
  await Promise.all(types.map((type) => seedBulkType(type.name, type.id, user.id)))

  console.log('Seeding complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
