import { NextRequest } from 'next/server'
import { getCachedSession } from '@/lib/session'
import {
  buildCheckoutReturnRedirectPath,
  checkoutInfoNotification,
  type CheckoutInfoMessageKey,
  type CheckoutReturnNotification,
} from '@/lib/billing/checkout/checkout-return-params'
import { finalizeCheckoutReturn } from '@/lib/billing/checkout/finalize-checkout-return'
import { createLogger } from '@/lib/infra/logger'
import { rateLimitAction } from '@/lib/infra/rate-limit'
import { apiRedirect, apiRoute } from '@/lib/api'
import { z } from 'zod'

const log = createLogger('checkout-return')

const checkoutSessionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^cs_/, 'Invalid checkout session.')
  .optional()

function redirectToSettings(request: NextRequest, messageKey: CheckoutInfoMessageKey) {
  const redirectPath = buildCheckoutReturnRedirectPath(checkoutInfoNotification(messageKey))
  return apiRedirect(new URL(redirectPath, request.url))
}

function buildSignInRedirect(request: NextRequest): URL {
  const returnPath = `${request.nextUrl.pathname}${request.nextUrl.search}`
  const signInUrl = new URL('/sign-in', request.url)
  signInUrl.searchParams.set('callbackUrl', returnPath)
  return signInUrl
}

export const GET = apiRoute(async (request: NextRequest) => {
  const session = await getCachedSession()
  if (!session?.user?.id) {
    return apiRedirect(buildSignInRedirect(request))
  }

  const rateLimit = await rateLimitAction('stripeSync', session.user.id)
  if (rateLimit) {
    return redirectToSettings(request, 'rate_limited')
  }

  const rawSessionId = request.nextUrl.searchParams.get('session_id')
  let sessionId: string | undefined
  if (rawSessionId !== null) {
    const parsedSessionId = checkoutSessionIdSchema.safeParse(rawSessionId)
    if (!parsedSessionId.success) {
      log.warn('Invalid checkout session_id — falling back to passive sync', {
        userId: session.user.id,
        sessionId: rawSessionId,
      })
      sessionId = undefined
    } else {
      sessionId = parsedSessionId.data
    }
  }
  let notification: CheckoutReturnNotification | null
  try {
    notification = await finalizeCheckoutReturn({
      userId: session.user.id,
      checkoutSuccess: true,
      sessionId,
    })
  } catch (error) {
    log.error('Checkout return finalization failed — redirecting with sync recovery', {
      userId: session.user.id,
      sessionId,
      error,
    })
    const redirectPath = buildCheckoutReturnRedirectPath({ type: 'syncing' })
    return apiRedirect(new URL(redirectPath, request.url))
  }

  if (!notification) {
    log.warn('Checkout return API hit without a finalization result', { userId: session.user.id })
    return apiRedirect(new URL('/settings', request.url))
  }

  const redirectPath = buildCheckoutReturnRedirectPath(notification)
  log.info('Checkout return finalized — redirecting to settings', {
    userId: session.user.id,
    sessionId,
    outcome: notification.type,
  })

  return apiRedirect(new URL(redirectPath, request.url))
})
