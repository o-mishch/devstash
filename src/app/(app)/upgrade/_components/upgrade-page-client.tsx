'use client'

import { useState, useEffect, useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { ArrowRight, Zap } from 'lucide-react'
import { BillingToggle, PricingCards, type BillingPeriod } from '@/components/shared/pricing-cards'
import { createCheckoutSessionAction } from '@/actions/stripe'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface CheckoutButtonProps {
  label: string
}

function CheckoutButton({ label }: CheckoutButtonProps) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-cyan-500 px-6 py-2.5 text-sm font-semibold text-slate-900 shadow-lg shadow-cyan-500/20 transition-all hover:from-blue-400 hover:to-cyan-400 hover:-translate-y-0.5 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed disabled:translate-y-0"
    >
      {pending ? 'Redirecting...' : label}
      {!pending && <ArrowRight size={14} />}
    </button>
  )
}

interface UpgradePageClientProps {
  priceIdMonthly: string | undefined
  priceIdYearly: string | undefined
}

export function UpgradePageClient({ priceIdMonthly, priceIdYearly }: UpgradePageClientProps) {
  const [billing, setBilling] = useState<BillingPeriod>('yearly')
  const isYearly = billing === 'yearly'

  const [monthlyState, monthlyFormAction] = useActionState(
    createCheckoutSessionAction.bind(null, priceIdMonthly ?? ''),
    null
  )
  const [yearlyState, yearlyFormAction] = useActionState(
    createCheckoutSessionAction.bind(null, priceIdYearly ?? ''),
    null
  )

  useEffect(() => {
    if (monthlyState && monthlyState.status !== 'ok') {
      toast.error(monthlyState.message ?? 'Unable to start checkout. Please try again.')
    }
    if (yearlyState && yearlyState.status !== 'ok') {
      toast.error(yearlyState.message ?? 'Unable to start checkout. Please try again.')
    }
  }, [monthlyState, yearlyState])

  const freeCta = (
    <div className={cn(
      'flex w-full items-center justify-center rounded-xl border border-border px-6 py-2.5 text-sm font-medium text-muted-foreground',
    )}>
      Current plan
    </div>
  )

  const proCta = (
    <form action={isYearly ? yearlyFormAction : monthlyFormAction}>
      <CheckoutButton label="Upgrade to Pro" />
    </form>
  )

  return (
    <div className="mx-auto my-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-4 text-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
          <Zap className="size-3" />
          Upgrade to Pro
        </div>
        <h1 className="mb-1 text-2xl font-bold md:text-3xl">Unlock everything in DevStash</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          File & image uploads, unlimited items, AI features, and more.
        </p>
        <BillingToggle billing={billing} onChange={setBilling} />
      </div>

      <PricingCards billing={billing} freeCta={freeCta} proCta={proCta} />
    </div>
  )
}
