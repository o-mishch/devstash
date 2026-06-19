import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { REQUIRED_STRIPE_WEBHOOK_EVENTS } from './stripe-webhook-config'
import { SUBSCRIPTION_UPSERT_SOURCE_EVENTS } from '@/lib/billing/subscription/stripe-subscription-persist'

// Drift guard: the events we SUBSCRIBE TO + DOCUMENT (REQUIRED_STRIPE_WEBHOOK_EVENTS, which also
// drives the /api-docs webhook section and validateStripeWebhookEndpoints) must exactly match the
// events the handler actually REACTS TO. If someone adds a `case` to the switch without registering
// it in the config (so Stripe is never told to send it), or registers a config event no handler
// reads (a dead subscription), this fails. The handler's reactive set = the switch `case` labels +
// the subscription-upsert events routed before the switch via isSubscriptionUpsertEvent.

const HANDLER_PATH = resolve(
  process.cwd(),
  'src/lib/billing/webhook/stripe-webhook-event-handlers.ts',
)

function handledEventTypes(): Set<string> {
  const source = readFileSync(HANDLER_PATH, 'utf8')
  const switchCases = [...source.matchAll(/case '([^']+)':/g)].map((match) => match[1])
  return new Set<string>([...switchCases, ...SUBSCRIPTION_UPSERT_SOURCE_EVENTS])
}

describe('Stripe webhook event config', () => {
  it('subscribes to exactly the events the handler reacts to (no gaps, no dead subscriptions)', () => {
    const config = new Set<string>(REQUIRED_STRIPE_WEBHOOK_EVENTS)
    const handled = handledEventTypes()

    const handledButNotSubscribed = [...handled].filter((type) => !config.has(type)).sort()
    const subscribedButNotHandled = [...config].filter((type) => !handled.has(type)).sort()

    expect(handledButNotSubscribed).toEqual([])
    expect(subscribedButNotHandled).toEqual([])
  })

  it('has no duplicate event types in the config', () => {
    const unique = new Set(REQUIRED_STRIPE_WEBHOOK_EVENTS)
    expect(unique.size).toBe(REQUIRED_STRIPE_WEBHOOK_EVENTS.length)
  })
})
