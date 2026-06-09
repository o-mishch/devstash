'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { getCheckoutNotificationMessage } from '@/lib/billing/messages/billing-messages.client'
import type { CheckoutReturnNotification } from '@/lib/billing/checkout/checkout-return-params'

interface BillingCheckoutNotificationProps {
  notification: CheckoutReturnNotification | null
  redirectTo?: string
}

/** Shows a one-time toast after server-side checkout finalization and strips return URL params. */
export function BillingCheckoutNotification({
  notification,
  redirectTo = '/settings',
}: BillingCheckoutNotificationProps) {
  const router = useRouter()
  const shownRef = useRef(false)

  useEffect(() => {
    if (!notification || shownRef.current) return
    shownRef.current = true

    const message = getCheckoutNotificationMessage(notification)
    if (notification.type === 'success') {
      toast.success(message)
    } else {
      toast.info(message)
    }

    router.replace(redirectTo)
  }, [notification, redirectTo, router])

  return null
}
