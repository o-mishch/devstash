'use client'

import { useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { api } from '@/lib/api/client'
import { BillingAlert } from '@/components/billing/billing-alert'
import { BillingToggle } from '@/components/billing/billing-toggle'
import { PendingFormButton } from '@/components/shared/pending-form-button'
import { PricingProPrice } from '@/components/billing/pricing-cards-display'
import { CHECKOUT_DISABLED_RECOVERY_MESSAGE } from '@/lib/billing/messages/billing-messages.client'
import type { BillingPeriod } from '@/lib/billing/config/billing-pricing.client'
import { useApiFormAction } from '@/hooks/use-api-form-action'
import { useUpgradeBillingStore } from '@/stores/upgrade-billing'

interface UpgradeBillingShellProps {
  defaultBilling?: BillingPeriod
  checkoutDisabled?: boolean
  checkoutDisabledMessage?: string | null
  priceIdMonthly?: string
  priceIdYearly?: string
  children: ReactNode
}

export function UpgradeBillingShell({
  defaultBilling = 'yearly',
  checkoutDisabled = false,
  checkoutDisabledMessage,
  priceIdMonthly,
  priceIdYearly,
  children,
}: UpgradeBillingShellProps) {
  const billing = useUpgradeBillingStore((s) => s.billing)
  const setBilling = useUpgradeBillingStore((s) => s.setBilling)

  const seedKey = [defaultBilling, priceIdMonthly ?? '', priceIdYearly ?? '', checkoutDisabled, checkoutDisabledMessage ?? ''].join('|')

  // Seed synchronously during render (not in an effect) so the first paint already reflects the
  // server-provided pricing/config — an effect-time init flashes default state (missing CTA, wrong
  // period) for one frame. "Adjust state when props change" pattern: re-seed only on a value change.
  const [seededKey, setSeededKey] = useState<string | null>(null)
  if (seededKey !== seedKey) {
    setSeededKey(seedKey)
    useUpgradeBillingStore.getState().init({ defaultBilling, priceIdMonthly, priceIdYearly, checkoutDisabled, checkoutDisabledMessage })
  }

  return (
    <div className="mx-auto my-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4 flex justify-center">
        <BillingToggle billing={billing} onChange={setBilling} />
      </div>
      {children}
    </div>
  )
}

export function UpgradeProPrice() {
  const billing = useUpgradeBillingStore((s) => s.billing)
  return <PricingProPrice isYearly={billing === 'yearly'} />
}

export function UpgradeProCheckout() {
  const selectedPriceId = useUpgradeBillingStore((s) =>
    s.billing === 'yearly' ? s.priceIdYearly : s.priceIdMonthly
  )
  const checkoutDisabled = useUpgradeBillingStore((s) => s.checkoutDisabled)
  const checkoutDisabledMessage = useUpgradeBillingStore((s) => s.checkoutDisabledMessage)

  const { formAction: checkoutFormAction } = useApiFormAction(
    async (body) => {
      const { data, error } = await api.POST('/billing/checkout', { body: { priceId: body.priceId } })
      if (error) throw new Error(error.message)
      return data
    },
    {
      fallbackError: 'Unable to start checkout. Please try again.',
      // Hard redirect to the Stripe-hosted checkout (external URL, outside React routing).
      onSuccess: (data) => { window.location.href = data.url },
    },
  )

  if (checkoutDisabled) {
    return (
      <BillingAlert variant="inline" className="w-full">
        {checkoutDisabledMessage ?? CHECKOUT_DISABLED_RECOVERY_MESSAGE}
      </BillingAlert>
    )
  }

  if (!selectedPriceId) {
    return null
  }

  return (
    <form action={checkoutFormAction} className="w-full">
      <input type="hidden" name="priceId" value={selectedPriceId} />
      <PendingFormButton
        label="Upgrade to Pro"
        trailingIcon={<ArrowRight size={14} />}
        className="h-auto w-full gap-2 rounded-xl border-transparent bg-gradient-to-r from-blue-500 to-cyan-500 px-6 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-cyan-500/20 hover:from-blue-400 hover:to-cyan-400 hover:-translate-y-0.5 active:scale-95 disabled:translate-y-0 [a]:hover:bg-gradient-to-r"
      />
    </form>
  )
}
