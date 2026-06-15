import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCachedSession } from '@/lib/session'
import type { SettingsCheckoutSearchParams } from '@/lib/billing/checkout/checkout-return-params'
import { EditorPreferencesForm } from '@/components/settings/editor-preferences-form'
import { BillingSettings } from '@/components/billing/billing-settings'

interface SettingsPageProps {
  searchParams: Promise<SettingsCheckoutSearchParams>
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const session = await getCachedSession()
  if (!session?.user?.id) redirect('/sign-in')

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
        <Suspense fallback={<div className="h-48 rounded-xl border bg-muted/30 animate-pulse" />}>
          <BillingSettings
            userId={session.user.id}
            fallbackIsPro={session.user.isPro ?? false}
            searchParams={searchParams}
          />
        </Suspense>
        <EditorPreferencesForm />
      </div>
    </div>
  )
}
