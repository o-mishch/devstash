const isDev = process.env.NODE_ENV === 'development'

// ANSI color codes — only applied in dev (terminals support them; log aggregators don't)
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const CYAN = '\x1b[36m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'

function level(label: string, color: string): string {
  return isDev ? `${BOLD}${color}${label}${RESET}` : label
}

function fmt(tag: string, label: string, labelColor: string, message: string): string {
  if (isDev) {
    const ts = `${DIM}${new Date().toTimeString().slice(0, 8)}${RESET}`
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
  info(message: string, context?: unknown): void
  warn(message: string, context?: unknown): void
  error(message: string, context?: unknown): void
}

export function toErrorMessage(err: unknown, fallback?: string): string {
  return err instanceof Error ? err.message : (fallback ?? String(err))
}

function serializeValue(v: unknown): unknown {
  return v instanceof Error ? v.message : v
}

function withContext(message: string, context?: unknown): string {
  if (context === undefined || context === null) return message
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
  return suffix ? `${message} | ${suffix}` : message
}

export function createLogger(tag?: string): ScopedLogger {
  const resolvedTag = tag ?? callerTag()
  return {
    info: (message, context) => console.log(fmt(resolvedTag, 'INFO', CYAN, withContext(message, context))),
    warn: (message, context) => console.warn(fmt(resolvedTag, 'WARN', YELLOW, withContext(message, context))),
    error: (message, context) => console.error(fmt(resolvedTag, 'ERROR', RED, withContext(message, context))),
  }
}
