import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCachedSession } from '@/lib/session'
import {
  type SettingsCheckoutSearchParams,
  checkoutNotificationFromSearchParams,
} from '@/lib/billing/checkout/checkout-return-params'
import { loadBillingPageContext, toBillingContextResponse } from '@/lib/billing/sync/user-billing-state'
import { getUserUsageStats } from '@/lib/db/usage'
import { EditorPreferencesForm } from '@/components/settings/editor-preferences-form'
import { BillingSettings } from '@/components/billing/billing-settings'
import SettingsLoading from './loading'

interface SettingsPageProps {
  searchParams: Promise<SettingsCheckoutSearchParams & { skeleton?: string }>
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const session = await getCachedSession()
  if (!session?.user?.id) redirect('/sign-in')

  const resolvedSearchParams = await searchParams

  // `?skeleton=true` preview: render the same skeleton loading.tsx shows, after the auth guard.
  if (resolvedSearchParams.skeleton === 'true') return <SettingsLoading />

  // Seed the client billing cache from SSR so /settings paints instantly (no skeleton flash, no extra
  // fetch). On return from a Stripe checkout, pull fresh state so the plan reflects the upgrade before
  // the webhook lands instead of briefly showing the stale tier.
  const needsFreshBilling = checkoutNotificationFromSearchParams(resolvedSearchParams) !== null
  const [billingPage, usage] = await Promise.all([
    loadBillingPageContext(session.user.id, session.user.isPro ?? false, {
      freshBillingContext: needsFreshBilling,
    }),
    getUserUsageStats(session.user.id),
  ])
  const billingContext = toBillingContextResponse(billingPage, usage)

  return (
    <div className="app-page gap-6 p-6">
      <div className="flex items-start gap-3">
        <Link
          href="/dashboard"
          prefetch={false}
          className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your editor and application preferences</p>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <BillingSettings initialData={billingContext} searchParams={resolvedSearchParams} />
        <EditorPreferencesForm />
      </div>
    </div>
  )
}
