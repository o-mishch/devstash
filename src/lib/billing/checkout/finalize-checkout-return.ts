import 'server-only'

import { revalidatePath } from 'next/cache'
import { finalizeCheckoutSessionForUser } from '@/lib/billing/checkout/stripe-checkout'
import {
  checkoutInfoNotification,
  type CheckoutReturnNotification,
} from '@/lib/billing/checkout/checkout-return-params'
import {
  syncSubscriptionStateForUser,
  type SubscriptionSyncResult,
} from '@/lib/billing/sync/passive-billing-sync'
import { logger } from '@/lib/infra/pino'

const log = logger.child({ tag: 'checkout-finalize' })

function revalidateBillingShell(): void {
  revalidatePath('/settings')
  revalidatePath('/', 'layout')
}

export type { CheckoutReturnNotification } from '@/lib/billing/checkout/checkout-return-params'

export interface FinalizeCheckoutReturnParams {
  userId: string
  checkoutSuccess?: boolean
  sessionId?: string
}

function notificationFromSyncResult(result: SubscriptionSyncResult): CheckoutReturnNotification {
  switch (result.status) {
    case 'updated':
      return { type: 'success' }
    case 'unchanged':
      return { type: 'syncing' }
    case 'unavailable':
      return checkoutInfoNotification('sync_pending')
    case 'no_subscription':
      return checkoutInfoNotification('no_subscription')
    case 'revoked':
    case 'cleared':
      return checkoutInfoNotification('activation_failed')
    default:
      return { type: 'syncing' }
  }
}

/** Finalizes a Stripe Checkout return on the server before billing UI renders. */
export async function finalizeCheckoutReturn(
  params: FinalizeCheckoutReturnParams,
): Promise<CheckoutReturnNotification | null> {
  const { userId, checkoutSuccess, sessionId } = params

  if (!checkoutSuccess) return null

  if (!sessionId) {
    const result = await syncSubscriptionStateForUser(userId, { attemptOrphanReconcile: true })
    const notification = notificationFromSyncResult(result)
    revalidateBillingShell()
    log.info({ userId, syncStatus: result.status, outcome: notification.type }, 'Checkout return finalized without session id')
    return notification
  }

  const result = await finalizeCheckoutSessionForUser(userId, sessionId)
  if (result.status === 'ok') {
    revalidateBillingShell()
    const notification: CheckoutReturnNotification = result.grantsAccess
      ? { type: 'success' }
      : { type: 'syncing' }
    log.info({
      userId,
      sessionId,
      outcome: notification.type,
      grantsAccess: result.grantsAccess,
    }, 'Checkout return finalized')
    return notification
  }
  if (result.status === 'forbidden') {
    log.warn({ userId, sessionId }, 'Checkout return forbidden for session owner mismatch')
    return checkoutInfoNotification('session_owner_mismatch')
  }
  if (result.status === 'invalid_session') {
    log.warn({ userId, sessionId }, 'Checkout return invalid session')
    return checkoutInfoNotification('invalid_session')
  }
  if (result.status === 'unavailable') {
    const syncResult = await syncSubscriptionStateForUser(userId, { attemptOrphanReconcile: true })
    revalidateBillingShell()
    const notification = notificationFromSyncResult(syncResult)
    log.info({
      userId,
      sessionId,
      syncStatus: syncResult.status,
      outcome: notification.type,
    }, 'Checkout return unavailable — attempted sync recovery')
    return notification
  }

  log.warn({ userId, sessionId, status: result.status }, 'Checkout return finalization returned unexpected status')
  return checkoutInfoNotification('sync_pending')
}
