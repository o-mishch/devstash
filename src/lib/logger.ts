const isDev = process.env.NODE_ENV === 'development'

function fmt(tag: string, message: string): string {
  if (isDev) {
    const ts = new Date().toTimeString().slice(0, 8)
    return `${ts} [${tag}] ${message}`
  }
  return `[${tag}] ${message}`
}

interface ScopedLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string, err?: unknown): void
}

export function createLogger(tag: string): ScopedLogger {
  return {
    info: (message) => console.log(fmt(tag, message)),
    warn: (message) => console.warn(fmt(tag, message)),
    error: (message, err) => {
      if (err !== undefined) {
        console.error(fmt(tag, message), err)
      } else {
        console.error(fmt(tag, message))
      }
    },
  }
}
