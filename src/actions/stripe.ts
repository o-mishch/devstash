'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { fetchLiveSubscriptionState, createCheckoutSession, createPortalSession, setSubscriptionCancelAtPeriodEnd } from '@/lib/stripe'
import { getUserStripeInfo, updateSubscriptionState } from '@/lib/db/stripe'
import { getSession, withAuth } from '@/lib/session'
import { ApiResponse } from '@/lib/api'
import { createLogger } from '@/lib/logger'
import { getBaseUrl } from '@/lib/utils/url'
import type { ApiBody } from '@/types/api'

const log = createLogger('stripe-actions')

// redirect() throws NEXT_REDIRECT — withAuth's try/catch would swallow it.
// Checkout also needs email, which SessionContext doesn't expose.
interface SessionUser {
  userId: string
  email: string | null | undefined
}

async function requireAuth(): Promise<SessionUser | null> {
  const session = await getSession()
  if (!session?.user?.id) return null
  return { userId: session.user.id, email: session.user.email }
}

async function toggleCancelSubscription(cancel: boolean): Promise<ApiBody<null>> {
  return withAuth(async ({ userId }) => {
    const user = await getUserStripeInfo(userId)
    if (!user?.stripeSubscriptionId) {
      return ApiResponse.BAD_REQUEST('No active subscription found. Please contact support.')
    }

    try {
      await setSubscriptionCancelAtPeriodEnd(user.stripeSubscriptionId, cancel)
      await updateSubscriptionState(user.stripeSubscriptionId, { cancelAtPeriodEnd: cancel })
      revalidatePath('/settings')
      log.info(`${cancel ? 'Canceled' : 'Reactivated'} subscription ${user.stripeSubscriptionId} for user:${userId}`)
      return ApiResponse.OK()
    } catch (err) {
      log.error(`Failed to ${cancel ? 'cancel' : 'reactivate'} subscription`, { userId, error: err })
      return ApiResponse.INTERNAL_ERROR(`Unable to ${cancel ? 'cancel' : 'reactivate'} subscription. Please try again.`)
    }
  })
}

export async function syncSubscriptionStateAction(): Promise<ApiBody<null>> {
  return withAuth(async ({ userId }) => {
    const user = await getUserStripeInfo(userId)
    if (!user?.stripeSubscriptionId) return ApiResponse.OK()

    const live = await fetchLiveSubscriptionState(user.stripeSubscriptionId)
    if (!live) return ApiResponse.OK()

    await updateSubscriptionState(user.stripeSubscriptionId, {
      cancelAtPeriodEnd: live.cancelAtPeriodEnd,
      ...(live.currentPeriodEnd && { currentPeriodEnd: live.currentPeriodEnd }),
      ...(live.interval && { subscriptionInterval: live.interval }),
    })
    revalidatePath('/settings')
    log.warn(`syncSubscriptionState → stale DB state synced from Stripe`, { subscriptionId: user.stripeSubscriptionId })
    return ApiResponse.OK()
  })
}

export async function createCheckoutSessionAction(
  priceId: string
): Promise<ApiBody<null>> {
  const auth = await requireAuth()
  if (!auth) return ApiResponse.UNAUTHORIZED()

  let checkoutUrl: string
  let checkoutSessionId: string
  try {
    const stripeSession = await createCheckoutSession({
      priceId,
      userId: auth.userId,
      userEmail: auth.email ?? undefined,
      successUrl: `${getBaseUrl()}/settings?success=true`,
      cancelUrl: `${getBaseUrl()}/settings?canceled=true`,
    })
    if (!stripeSession.url) {
      log.warn(`Stripe checkout session created but URL missing for user:${auth.userId}`)
      return ApiResponse.INTERNAL_ERROR('Failed to create Stripe session URL')
    }
    checkoutUrl = stripeSession.url
    checkoutSessionId = stripeSession.id
  } catch (err) {
    log.error('Failed to create checkout session', { userId: auth.userId, error: err })
    return ApiResponse.INTERNAL_ERROR('Unable to start checkout. Please try again.')
  }

  log.info(`Created checkout session ${checkoutSessionId} for user:${auth.userId}`)
  redirect(checkoutUrl)
}

export async function createPortalSessionAction(): Promise<ApiBody<null>> {
  const auth = await requireAuth()
  if (!auth) return ApiResponse.UNAUTHORIZED()

  const user = await getUserStripeInfo(auth.userId)
  if (!user?.stripeCustomerId) {
    log.warn(`Portal access attempted but no stripeCustomerId for user:${auth.userId}`)
    return ApiResponse.BAD_REQUEST('No subscription found. Please contact support.')
  }

  let portalUrl: string
  try {
    const portalSession = await createPortalSession(user.stripeCustomerId, `${getBaseUrl()}/settings`)
    if (!portalSession.url) {
      log.warn(`Stripe portal session created but URL missing for user:${auth.userId}`)
      return ApiResponse.INTERNAL_ERROR('Failed to create Portal session URL')
    }
    portalUrl = portalSession.url
  } catch (err) {
    log.error('Failed to create portal session', { userId: auth.userId, error: err })
    return ApiResponse.INTERNAL_ERROR('Unable to open billing portal. Please try again.')
  }

  log.info(`Created portal session for user:${auth.userId}`)
  redirect(portalUrl)
}

export async function cancelSubscriptionAction(): Promise<ApiBody<null>> {
  return toggleCancelSubscription(true)
}

export async function reactivateSubscriptionAction(): Promise<ApiBody<null>> {
  return toggleCancelSubscription(false)
}
