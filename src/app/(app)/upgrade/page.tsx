import { redirect } from 'next/navigation'
import { getSession } from '@/lib/session'
import { UpgradePageClient } from './_components/upgrade-page-client'

export default async function UpgradePage() {
  const session = await getSession()
  if (!session?.user) redirect('/sign-in')
  if (session.user.isPro) redirect('/settings')

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <UpgradePageClient
        priceIdMonthly={process.env.STRIPE_PRICE_ID_MONTHLY}
        priceIdYearly={process.env.STRIPE_PRICE_ID_YEARLY}
      />
    </div>
  )
}
