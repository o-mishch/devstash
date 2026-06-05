'use client'

import { useEffect, useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { createCheckoutSessionAction, createPortalSessionAction } from '@/actions/stripe'
import { PRICING } from '@/lib/utils/constants'
import { toast } from 'sonner'

interface BillingSubmitButtonProps {
  label: string
}

function BillingSubmitButton({ label }: BillingSubmitButtonProps) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? 'Redirecting...' : label}
    </Button>
  )
}

interface BillingFormsProps {
  isPro: boolean
  priceIdMonthly: string | undefined
  priceIdYearly: string | undefined
}

export function BillingForms({ isPro, priceIdMonthly, priceIdYearly }: BillingFormsProps) {
  const searchParams = useSearchParams()
  const [portalState, portalFormAction] = useActionState(createPortalSessionAction, null)
  const [monthlyState, monthlyFormAction] = useActionState(
    createCheckoutSessionAction.bind(null, priceIdMonthly ?? ''),
    null
  )
  const [yearlyState, yearlyFormAction] = useActionState(
    createCheckoutSessionAction.bind(null, priceIdYearly ?? ''),
    null
  )

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

  useEffect(() => {
    if (portalState && portalState.status !== 'ok') {
      toast.error(portalState.message ?? 'Unable to open billing portal. Please try again.')
    }
    if (monthlyState && monthlyState.status !== 'ok') {
      toast.error(monthlyState.message ?? 'Unable to start checkout. Please try again.')
    }
    if (yearlyState && yearlyState.status !== 'ok') {
      toast.error(yearlyState.message ?? 'Unable to start checkout. Please try again.')
    }
  }, [portalState, monthlyState, yearlyState])

  if (isPro) {
    return (
      <form action={portalFormAction}>
        <BillingSubmitButton label="Manage Subscription" />
      </form>
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
