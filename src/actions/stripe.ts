'use server'

import { redirect } from 'next/navigation'
import { stripe } from '@/lib/stripe'
import { getUserStripeCustomerId } from '@/lib/db/stripe'
import { getSession } from '@/lib/session'
import { ApiResponse } from '@/lib/api'
import { createLogger } from '@/lib/logger'
import { getBaseUrl } from '@/lib/utils/url'
import type { ApiBody } from '@/types/api'

const log = createLogger('stripe-actions')

export async function createCheckoutSessionAction(
  priceId: string
): Promise<ApiBody<null>> {
  const session = await getSession()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED()
  const userId = session.user.id

  let checkoutUrl: string
  let checkoutSessionId: string
  try {
    const stripeSession = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${getBaseUrl()}/settings?success=true`,
      cancel_url: `${getBaseUrl()}/settings?canceled=true`,
      client_reference_id: userId,
      customer_email: session.user.email ?? undefined,
    })
    if (!stripeSession.url) {
      log.warn(`Stripe checkout session created but URL missing for user:${userId}`)
      return ApiResponse.INTERNAL_ERROR('Failed to create Stripe session URL')
    }
    checkoutUrl = stripeSession.url
    checkoutSessionId = stripeSession.id
  } catch (err) {
    log.error('Failed to create checkout session', { userId, error: String(err) })
    return ApiResponse.INTERNAL_ERROR('Unable to start checkout. Please try again.')
  }

  log.info(`Created checkout session ${checkoutSessionId} for user:${userId}`)
  redirect(checkoutUrl)
}

export async function createPortalSessionAction(): Promise<ApiBody<null>> {
  const session = await getSession()
  if (!session?.user?.id) return ApiResponse.UNAUTHORIZED()

  const user = await getUserStripeCustomerId(session.user.id)
  if (!user?.stripeCustomerId) {
    log.warn(`Portal access attempted but no stripeCustomerId for user:${session.user.id}`)
    return ApiResponse.BAD_REQUEST('No subscription found. Please contact support.')
  }

  let portalUrl: string
  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${getBaseUrl()}/settings`,
    })
    if (!portalSession.url) {
      log.warn(`Stripe portal session created but URL missing for user:${session.user.id}`)
      return ApiResponse.INTERNAL_ERROR('Failed to create Portal session URL')
    }
    portalUrl = portalSession.url
  } catch (err) {
    log.error('Failed to create portal session', { userId: session.user.id, error: String(err) })
    return ApiResponse.INTERNAL_ERROR('Unable to open billing portal. Please try again.')
  }

  log.info(`Created portal session for user:${session.user.id}`)
  redirect(portalUrl)
}
