'use client'

import { createContext, useContext, useState, type ComponentProps, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { createCheckoutSessionFormAction } from '@/actions/billing'
import { BillingAlert } from '@/components/billing/billing-alert'
import { BillingToggle } from '@/components/billing/billing-toggle'
import { PendingFormButton } from '@/components/shared/pending-form-button'
import { PricingProPrice } from '@/components/billing/pricing-cards-display'
import { CHECKOUT_DISABLED_RECOVERY_MESSAGE } from '@/lib/billing/messages/billing-messages.client'
import type { BillingPeriod } from '@/lib/billing/config/billing-pricing.client'
import { useActionStateWithToast } from '@/hooks/use-action-state-with-toast'

interface UpgradeBillingContextValue {
  isYearly: boolean
  checkoutFormAction: NonNullable<ComponentProps<'form'>['action']>
  selectedPriceId: string | undefined
  checkoutDisabled: boolean
  checkoutDisabledMessage?: string | null
}

const UpgradeBillingContext = createContext<UpgradeBillingContextValue | null>(null)

function useUpgradeBilling(): UpgradeBillingContextValue {
  const value = useContext(UpgradeBillingContext)
  if (!value) throw new Error('Upgrade billing components must render inside UpgradeBillingShell')
  return value
}

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
  const [billing, setBilling] = useState<BillingPeriod>(defaultBilling)
  const isYearly = billing === 'yearly'
  const selectedPriceId = isYearly ? priceIdYearly : priceIdMonthly
  const { formAction: checkoutFormAction } = useActionStateWithToast(createCheckoutSessionFormAction, {
    fallbackError: 'Unable to start checkout. Please try again.',
  })

  return (
    <UpgradeBillingContext
      value={{
        isYearly,
        checkoutFormAction,
        selectedPriceId,
        checkoutDisabled,
        checkoutDisabledMessage,
      }}
    >
      <div className="mx-auto my-auto w-full max-w-3xl px-4 py-6">
        <div className="mb-4 flex justify-center">
          <BillingToggle billing={billing} onChange={setBilling} />
        </div>
        {children}
      </div>
    </UpgradeBillingContext>
  )
}

export function UpgradeProPrice() {
  const { isYearly } = useUpgradeBilling()
  return <PricingProPrice isYearly={isYearly} />
}

export function UpgradeProCheckout() {
  const { checkoutFormAction, selectedPriceId, checkoutDisabled, checkoutDisabledMessage } = useUpgradeBilling()

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
