import { Redis } from '@upstash/redis'

let client: Redis | null = null

export function getRedis(): Redis | null {
  if (client) return client
  try {
    client = Redis.fromEnv()
    return client
  } catch {
    return null
  }
}
