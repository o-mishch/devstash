'server-only'

const isDev = process.env.NODE_ENV === 'development'

// ANSI color codes — only applied in dev (terminals support them; log aggregators don't)
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[38;5;178m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'

function level(label: string, color: string): string {
  return isDev ? `${BOLD}${color}${label}${RESET}` : label
}

function fmt(tag: string, label: string, labelColor: string, message: string): string {
  if (isDev) {
    const now = new Date()
    const h = String(now.getHours()).padStart(2, '0')
    const m = String(now.getMinutes()).padStart(2, '0')
    const s = String(now.getSeconds()).padStart(2, '0')
    const ms = String(now.getMilliseconds()).padStart(3, '0')
    const us = String(Math.floor((performance.now() % 1000) * 1000)).padStart(6, '0')
    const ts = `${DIM}${h}:${m}:${s}:${ms}:${us}${RESET}`
    const scope = `${CYAN}[${tag}]${RESET}`
    return `${ts} ${scope} ${level(label, labelColor)} ${message}`
  }
  return `[${tag}] ${label} ${message}`
}

function callerTag(): string {
  const stack = new Error().stack ?? ''
  // lines[0] = "Error", lines[1] = "at callerTag", lines[2] = "at createLogger", lines[3] = actual caller
  const callerLine = stack.split('\n')[3] ?? ''
  // matches both "/abs/path/file.ts:1:2" and "webpack-internal:///./src/actions/file.ts:1:2"
  const match = callerLine.match(/([^/\\(]+)\.\w+:\d+:\d+\)?$/)
  return match ? match[1] : 'app'
}

interface ScopedLogger {
  info(message: string, context?: unknown, description?: string): void
  warn(message: string, context?: unknown, description?: string): void
  error(message: string, context?: unknown, description?: string): void
}


export function toErrorMessage(err: unknown, fallback?: string): string {
  return err instanceof Error ? err.message : (fallback ?? String(err))
}

function serializeValue(v: unknown): unknown {
  return v instanceof Error ? v.message : v
}

function formatContext(context?: unknown): string | null {
  if (context === undefined || context === null) return null
  let suffix: string
  if (context instanceof Error) {
    suffix = `error=${JSON.stringify(context.message)}`
  } else if (typeof context === 'object') {
    suffix = Object.entries(context as Record<string, unknown>)
      .map(([k, v]) => `${k}=${JSON.stringify(serializeValue(v))}`)
      .join(' ')
  } else {
    suffix = JSON.stringify(context)
  }
  return suffix || null
}

function withContext(message: string, context?: unknown, description?: string): string {
  const parts = [message]
  const serializedContext = formatContext(context)
  if (serializedContext) parts.push(serializedContext)
  if (description) parts.push(description)
  return parts.join(' | ')
}

export function createLogger(tag?: string): ScopedLogger {
  const resolvedTag = tag ?? callerTag()
  return {
    info: (message, context, description) => console.log(fmt(resolvedTag, 'INFO', CYAN, withContext(message, context, description))),
    warn: (message, context, description) => console.warn(fmt(resolvedTag, 'WARN', YELLOW, withContext(message, context, description))),
    error: (message, context, description) => console.error(fmt(resolvedTag, 'ERROR', RED, withContext(message, context, description))),
  }
}

