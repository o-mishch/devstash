import 'server-only'
import pino from 'pino'

const isDev = process.env.NODE_ENV === 'development'

// pino-pretty is a devDependency loaded only in development — never bundled for production.
const devTransport = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:HH:MM:ss.l',
    // Drop noisy defaults and the `tag` binding (surfaced via messageFormat instead).
    ignore: 'pid,hostname,tag',
    messageFormat: '[{tag}] {msg}',
  },
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  ...(isDev ? { transport: devTransport } : {}),
})
