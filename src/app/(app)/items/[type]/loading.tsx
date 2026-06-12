'use client'

import { usePathname } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { ItemsTypeSkeleton } from '@/components/shared/skeletons'
import { slugToTypeName } from '@/lib/utils'

export default function ItemsLoading() {
  const pathname = usePathname()
  const slug = pathname.split('/').pop() ?? ''
  const typeName = slugToTypeName(slug)

  return (
    <div className="app-page gap-6 p-6">
      <div className="text-xl font-semibold">
        <Skeleton className="h-7 w-48" />
      </div>
      <ItemsTypeSkeleton typeName={typeName} />
    </div>
  )
}
