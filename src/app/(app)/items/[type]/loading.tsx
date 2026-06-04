'use client'

import { useParams } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'
import { CardGridSkeleton, PageHeaderSkeleton } from '@/components/shared/skeletons'

const SKELETON_COUNT = 6

function FileListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[...Array(SKELETON_COUNT)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
          <Skeleton className="size-5 shrink-0 rounded-sm" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2 sm:hidden" />
          </div>
          <Skeleton className="hidden h-3 w-32 shrink-0 sm:block" />
          <Skeleton className="hidden h-3 w-16 shrink-0 sm:block" />
          <Skeleton className="hidden h-3 w-20 shrink-0 sm:block" />
          <Skeleton className="size-8 shrink-0 rounded-md" />
          <Skeleton className="size-8 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  )
}

function ImageGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      {[...Array(SKELETON_COUNT)].map((_, i) => (
        <Card key={i} className="overflow-hidden rounded-lg p-0">
          <Skeleton className="aspect-video w-full rounded-none" />
        </Card>
      ))}
    </div>
  )
}


function SkeletonContent({ typeSlug }: { typeSlug: string }) {
  if (typeSlug === 'files') return <FileListSkeleton />
  if (typeSlug === 'images') return <ImageGridSkeleton />
  return <CardGridSkeleton />
}

export default function ItemsLoading() {
  const params = useParams<{ type: string }>()
  const typeSlug = params?.type ?? ''

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeaderSkeleton actionWidthClass="w-24" />

      <SkeletonContent typeSlug={typeSlug} />
    </div>
  )
}
