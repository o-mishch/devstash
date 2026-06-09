import 'dotenv/config'
import Stripe from 'stripe'
import { validateStripeWebhookEndpoints } from '@/lib/billing/config/stripe-webhook-config'

async function listStripeWebhookEndpoints(): Promise<Stripe.WebhookEndpoint[]> {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    throw new Error('STRIPE_SECRET_KEY is missing.')
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: '2026-05-27.dahlia',
    typescript: true,
  })
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
  return endpoints.data
}

async function main() {
  const result = validateStripeWebhookEndpoints(await listStripeWebhookEndpoints())

  for (const endpoint of result.endpoints) {
    console.log(`Endpoint ${endpoint.id}`)
    console.log(`  URL: ${endpoint.url}`)
    if (endpoint.missingEvents.length > 0) {
      console.log(`  Missing: ${endpoint.missingEvents.join(', ')}`)
    } else {
      console.log('  Required events: OK')
    }
  }

  console.log(result.message)

  if (!result.ok) {
    process.exit(1)
  }
}

main().catch((error) => {
  console.error('Stripe webhook validation failed:', error)
  process.exit(1)
})
