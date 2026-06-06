'use client'

import { useEffect, useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { useSearchParams } from 'next/navigation'
import { type VariantProps } from 'class-variance-authority'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  createCheckoutSessionAction,
  createPortalSessionAction,
  cancelSubscriptionAction,
  reactivateSubscriptionAction,
  syncSubscriptionStateAction,
} from '@/actions/stripe'
import { PRICING } from '@/lib/utils/constants'
import { toast } from 'sonner'

function useCheckoutNotification() {
  const searchParams = useSearchParams()
  useEffect(() => {
    const success = searchParams.get('success')
    const canceled = searchParams.get('canceled')
    if (success) {
      toast.success('Subscription successful! Welcome to DevStash Pro.')
    } else if (canceled) {
      toast.info('Checkout canceled. Your subscription has not been changed.')
    }
    if (success || canceled) {
      // replaceState cleans up the URL silently — router.replace would trigger a full re-render
      window.history.replaceState(null, '', '/settings')
    }
  }, [searchParams])
}

function useSyncSubscriptionState(isStale: boolean) {
  useEffect(() => {
    if (isStale) void syncSubscriptionStateAction()
  }, [isStale])
}

interface BillingSubmitButtonProps extends VariantProps<typeof buttonVariants> {
  label: string
}

function BillingSubmitButton({ label, variant = 'default' }: BillingSubmitButtonProps) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} disabled={pending} className="w-full sm:w-auto">
      {pending ? 'Redirecting...' : label}
    </Button>
  )
}

interface BillingFormsProps {
  isPro: boolean
  isCanceling: boolean
  priceIdMonthly: string | undefined
  priceIdYearly: string | undefined
  isStale?: boolean
}

export function BillingForms({
  isPro,
  isCanceling,
  priceIdMonthly,
  priceIdYearly,
  isStale = false,
}: BillingFormsProps) {
  useCheckoutNotification()
  useSyncSubscriptionState(isStale)

  const [portalState, portalFormAction] = useActionState(createPortalSessionAction, null)
  const [cancelState, cancelFormAction] = useActionState(cancelSubscriptionAction, null)
  const [reactivateState, reactivateFormAction] = useActionState(reactivateSubscriptionAction, null)
  const [monthlyState, monthlyFormAction] = useActionState(
    createCheckoutSessionAction.bind(null, priceIdMonthly ?? ''),
    null
  )
  const [yearlyState, yearlyFormAction] = useActionState(
    createCheckoutSessionAction.bind(null, priceIdYearly ?? ''),
    null
  )

  useEffect(() => {
    if (portalState && portalState.status !== 'ok') {
      toast.error(portalState.message ?? 'Unable to open billing portal. Please try again.')
    }
    if (cancelState && cancelState.status !== 'ok') {
      toast.error(cancelState.message ?? 'Unable to open cancellation flow. Please try again.')
    }
    if (reactivateState && reactivateState.status !== 'ok') {
      toast.error(reactivateState.message ?? 'Unable to reactivate subscription. Please try again.')
    }
    if (monthlyState && monthlyState.status !== 'ok') {
      toast.error(monthlyState.message ?? 'Unable to start checkout. Please try again.')
    }
    if (yearlyState && yearlyState.status !== 'ok') {
      toast.error(yearlyState.message ?? 'Unable to start checkout. Please try again.')
    }
  }, [portalState, cancelState, reactivateState, monthlyState, yearlyState])

  if (isPro) {
    if (isCanceling) {
      return (
        <div className="flex flex-col sm:flex-row gap-2">
          <form action={reactivateFormAction}>
            <BillingSubmitButton label="Keep Subscription" />
          </form>
          <form action={portalFormAction}>
            <BillingSubmitButton label="Manage Billing" variant="outline" />
          </form>
        </div>
      )
    }

    return (
      <div className="flex flex-col sm:flex-row gap-2">
        <form action={portalFormAction}>
          <BillingSubmitButton label="Manage Billing" variant="outline" />
        </form>
        <form action={cancelFormAction}>
          <BillingSubmitButton label="Cancel Subscription" variant="ghost" />
        </form>
      </div>
    )
  }

  return (
    <div className="flex flex-col sm:flex-row gap-2">
      {priceIdMonthly && (
        <form action={monthlyFormAction}>
          <BillingSubmitButton label={`Upgrade — ${PRICING.monthly.label}`} />
        </form>
      )}
      {priceIdYearly && (
        <form action={yearlyFormAction}>
          <BillingSubmitButton label={`Upgrade — ${PRICING.yearly.label}`} />
        </form>
      )}
    </div>
  )
}

