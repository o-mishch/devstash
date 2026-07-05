import { Suspense } from 'react'
import { notFound, redirect } from 'next/navigation'
import { getTypeLabel, getTypePlural, slugToTypeName } from '@/lib/utils'
import { PRO_ITEM_TYPE_NAMES, SYSTEM_TYPE_ORDER } from '@/lib/utils/constants'
import { getCachedSession } from '@/lib/session'
import { getCachedVerifiedProAccess } from '@/lib/billing/access/pro-access-resolution'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemsTypeSkeleton } from '@/components/shared/skeletons'
import { ItemsGrid } from '@/components/items/items-grid'
import { ItemDeepLink } from '@/components/items/item-deep-link'

interface ItemsPageProps {
  params: Promise<{ type: string }>
  searchParams: Promise<{ skeleton?: string }>
}

export default async function ItemsPage({ params, searchParams }: ItemsPageProps) {
  const { type: typeSlug } = await params

  // Item types are a fixed, immutable system set — validate the slug against the
  // constant instead of a per-navigation DB lookup.
  const typeName = slugToTypeName(typeSlug)
  if (!SYSTEM_TYPE_ORDER.includes(typeName)) notFound()

  // file/image are Pro-only. The edge proxy (auth.config.ts) redirects non-Pro users before this
  // renders (removing the pre-redirect flash); this server guard is the durable belt-and-suspenders,
  // denying a direct URL visit even if the edge check is bypassed. Runs before the skeleton branch so
  // the `?skeleton=true` preview never leaks a gated page to a non-Pro user.
  if (PRO_ITEM_TYPE_NAMES.has(typeName)) {
    const session = await getCachedSession()
    const userId = session?.user?.id
    if (!userId) redirect('/sign-in')
    if (!(await getCachedVerifiedProAccess(userId))) redirect(`/upgrade?gate=${getTypePlural(typeName)}`)
  }

  // `?skeleton=true` preview: render the same skeleton loading.tsx shows, after the slug + Pro guards.
  if ((await searchParams).skeleton === 'true') {
    return (
      <div className="app-page gap-6 p-6">
        <div className="text-xl font-semibold">
          <Skeleton className="h-7 w-48" />
        </div>
        <ItemsTypeSkeleton typeName={typeName} />
      </div>
    )
  }

  return (
    <div className="app-page gap-6 p-6">
      <Suspense fallback={null}>
        <ItemDeepLink />
      </Suspense>
      <ItemsGrid typeName={typeName} typeLabel={getTypeLabel(typeName)} />
    </div>
  )
}
