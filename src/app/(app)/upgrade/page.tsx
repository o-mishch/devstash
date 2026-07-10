import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { Zap } from 'lucide-react'
import { ProGatePromptTrigger } from '@/components/billing/pro-gate-prompt-trigger'
import { getCachedSession } from '@/lib/session'
import { loadBillingPageContext } from '@/lib/billing/sync/user-billing-state'
import { parseBillingPeriodParam } from '@/lib/billing/config/billing-pricing'
import { CURRENT_PLAN_CTA_CLASSNAME, CURRENT_PLAN_LABEL } from '@/lib/billing/messages/billing-messages.client'
import { FreePricingFeatures, ProPricingFeatures } from '@/components/billing/pricing-feature-lists'
import { PricingCardsDisplay } from '@/components/billing/pricing-cards-display'
import {
  UpgradeBillingShell,
  UpgradeProCheckout,
  UpgradeProPrice,
} from '@/components/billing/upgrade-billing-shell'

interface UpgradePageProps {
  searchParams: Promise<{ billing?: string }>
}

// Hoisted to module scope: none of these depend on any per-request prop or
// state, so they're created once per module load rather than once per JSX
// evaluation — this also resolves react-perf/jsx-no-jsx-as-prop honestly
// (not just cosmetically) since the reference is stable across renders.
const proPriceSlot = <UpgradeProPrice />
const freeCtaSlot = <div className={CURRENT_PLAN_CTA_CLASSNAME}>{CURRENT_PLAN_LABEL}</div>
const proCtaSlot = <UpgradeProCheckout />
const freeFeaturesSlot = <FreePricingFeatures />
const proFeaturesSlot = <ProPricingFeatures />

export default async function UpgradePage({ searchParams }: UpgradePageProps) {
  const session = await getCachedSession()
  if (!session?.user) redirect('/sign-in')

  const defaultBilling = parseBillingPeriodParam((await searchParams).billing)

  const {
    isPro,
    checkoutDisabled,
    checkoutDisabledMessage,
    priceIdMonthly,
    priceIdYearly,
  } = await loadBillingPageContext(
    session.user.id,
    session.user.isPro ?? false,
    { freshBillingContext: true },
  )
  if (isPro) redirect('/settings')

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      {/* Opens the "Pro Feature" dialog when arriving here from a Pro-only page's ?gate= redirect. */}
      <Suspense fallback={null}>
        <ProGatePromptTrigger />
      </Suspense>
      <div className="mx-auto w-full max-w-3xl px-4 pt-6 text-center">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
          <Zap className="size-3" />
          Upgrade to Pro
        </div>
        <h1 className="mb-1 text-2xl font-bold md:text-3xl">Unlock everything in DevStash</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          File & image uploads, unlimited items, AI features, and more.
        </p>
      </div>
      <UpgradeBillingShell
        defaultBilling={defaultBilling}
        checkoutDisabled={checkoutDisabled}
        checkoutDisabledMessage={checkoutDisabledMessage}
        priceIdMonthly={priceIdMonthly}
        priceIdYearly={priceIdYearly}
      >
        <PricingCardsDisplay
          proPrice={proPriceSlot}
          freeCta={freeCtaSlot}
          proCta={proCtaSlot}
          freeFeatures={freeFeaturesSlot}
          proFeatures={proFeaturesSlot}
        />
      </UpgradeBillingShell>
    </div>
  )
}
