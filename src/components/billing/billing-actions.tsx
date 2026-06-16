'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { api } from '@/lib/api/client'
import { buttonVariants } from '@/components/ui/button'
import { PendingFormButton } from '@/components/shared/pending-form-button'
import { useApiFormAction } from '@/hooks/use-api-form-action'
import { cn } from '@/lib/utils'
import {
  BILLING_CANCEL_FALLBACK_ERROR,
  BILLING_PORTAL_FALLBACK_ERROR,
  BILLING_REACTIVATE_FALLBACK_ERROR,
} from '@/lib/billing/messages/billing-messages.client'

interface BillingPortalFormProps {
  className?: string
}

function BillingPortalForm({ className }: BillingPortalFormProps) {
  const { formAction: portalFormAction } = useApiFormAction(
    async () => {
      const { data, error } = await api.POST('/billing/portal')
      if (error) throw new Error(error.message)
      return data
    },
    {
      fallbackError: BILLING_PORTAL_FALLBACK_ERROR,
      // Hard redirect to the Stripe-hosted billing portal (external URL, outside React routing).
      onSuccess: (data) => { window.location.href = data.url },
    },
  )

  return (
    <form action={portalFormAction}>
      <PendingFormButton label="Manage Billing" variant="outline" className={className} />
    </form>
  )
}

interface BillingActionsProps {
  isPro: boolean
  isCanceling: boolean
  canManageBilling: boolean
  showUpgradeCta?: boolean
  billingUnavailable?: boolean
}

interface FreeTierCheckoutActionsProps {
  canManageBilling: boolean
  showUpgradeCta: boolean
}

function FreeTierCheckoutActions({
  canManageBilling,
  showUpgradeCta,
}: FreeTierCheckoutActionsProps) {
  return (
    <div className="space-y-3">
      {canManageBilling && <BillingPortalForm className="w-full sm:w-auto" />}
      {showUpgradeCta && (
        <Link
          href="/upgrade"
          prefetch={false}
          className={cn(buttonVariants({ variant: 'default' }), 'w-full sm:w-auto gap-1.5')}
        >
          Upgrade to Pro
          <ArrowRight size={14} />
        </Link>
      )}
    </div>
  )
}

export function BillingActions({
  isPro,
  isCanceling,
  canManageBilling,
  showUpgradeCta = true,
  billingUnavailable = false,
}: BillingActionsProps) {
  const router = useRouter()
  const refreshBilling = () => router.refresh()

  const { formAction: cancelFormAction } = useApiFormAction(async () => {
    const { error } = await api.POST('/billing/cancel')
    if (error) throw new Error(error.message)
  }, {
    fallbackError: BILLING_CANCEL_FALLBACK_ERROR,
    onSuccess: refreshBilling,
  })
  const { formAction: reactivateFormAction } = useApiFormAction(async () => {
    const { error } = await api.POST('/billing/reactivate')
    if (error) throw new Error(error.message)
  }, {
    fallbackError: BILLING_REACTIVATE_FALLBACK_ERROR,
    onSuccess: refreshBilling,
  })

  if (isPro && billingUnavailable) {
    if (!canManageBilling) return null
    return <BillingPortalForm className="w-full sm:w-auto" />
  }

  if (isPro) {
    if (isCanceling) {
      return (
        <div className="flex flex-col sm:flex-row gap-2">
          <form action={reactivateFormAction}>
            <PendingFormButton label="Keep Subscription" className="w-full sm:w-auto" />
          </form>
          <BillingPortalForm className="w-full sm:w-auto" />
        </div>
      )
    }

    return (
      <div className="flex flex-col sm:flex-row gap-2">
        <BillingPortalForm className="w-full sm:w-auto" />
        <form action={cancelFormAction}>
          <PendingFormButton label="Cancel Subscription" variant="ghost" className="w-full sm:w-auto" />
        </form>
      </div>
    )
  }

  return (
    <FreeTierCheckoutActions
      canManageBilling={canManageBilling}
      showUpgradeCta={showUpgradeCta}
    />
  )
}
