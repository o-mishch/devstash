import { createLogger } from '../lib/infra/logger'

const REQUIRED_STRIPE_PRICE_ENV_KEYS = ['STRIPE_PRICE_ID_MONTHLY', 'STRIPE_PRICE_ID_YEARLY'] as const

const REQUIRED_REDIS_ENV_KEYS = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const

const REQUIRED_STRIPE_SECRET_ENV_KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const

const log = createLogger('stripe-config')

function getMissingEnvKeys(keys: readonly string[]): string[] {
  return keys.filter((key) => !process.env[key]?.trim())
}

/** Validates Stripe billing and Redis env vars when Next.js loads config (build/dev). */
export function validateStripeBillingEnv(): void {
  const missingStripe = getMissingEnvKeys(REQUIRED_STRIPE_PRICE_ENV_KEYS)
  if (missingStripe.length > 0) {
    const message = `Missing Stripe billing environment variables: ${missingStripe.join(', ')}`
    if (process.env.NODE_ENV === 'production') {
      throw new Error(message)
    }
    log.warn(message)
  }

  if (process.env.NODE_ENV === 'production') {
    const missingSecrets = getMissingEnvKeys(REQUIRED_STRIPE_SECRET_ENV_KEYS)
    if (missingSecrets.length > 0) {
      throw new Error(`Missing Stripe secret environment variables: ${missingSecrets.join(', ')}`)
    }
  }

  if (process.env.NODE_ENV !== 'production') return

  const missingRedis = getMissingEnvKeys(REQUIRED_REDIS_ENV_KEYS)
  if (missingRedis.length > 0) {
    throw new Error(
      `Production requires Upstash Redis (${REQUIRED_REDIS_ENV_KEYS.join(', ')}) for Pro access cache and rate limiting.`,
    )
  }
}
