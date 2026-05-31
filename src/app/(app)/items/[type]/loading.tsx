'use client'

import { useParams } from 'next/navigation'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

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

function CardGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
      {[...Array(SKELETON_COUNT)].map((_, i) => (
        <div key={i} className="flex h-20 items-center gap-3 rounded-lg border border-border p-4">
          <Skeleton className="size-8 shrink-0 rounded-md" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="ml-2 h-3 w-12 shrink-0" />
        </div>
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
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-8 w-24 rounded-md" />
      </div>

      <SkeletonContent typeSlug={typeSlug} />
    </div>
  )
}
