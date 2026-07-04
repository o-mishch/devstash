import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { ITEM_TYPES_WITH_IMAGE_GRID, ITEM_TYPES_WITH_FILE_LIST } from '@/lib/utils/constants'

interface PageHeaderSkeletonProps {
  actionWidthClass?: string
}

export function PageHeaderSkeleton({ actionWidthClass = 'w-36' }: PageHeaderSkeletonProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-1.5">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className={`h-8 rounded-md ${actionWidthClass}`} />
    </div>
  )
}

interface CardGridSkeletonProps {
  count?: number
}

export function CardGridSkeleton({ count = 6 }: CardGridSkeletonProps) {
  return (
    // Columns mirror the loaded list grid (getListGridColumns): 1/2/3 at <640/<1024/>=1024px.
    // Cell height uses the grid's ABSOLUTE px (itemHeight=100, touchItemHeight=96) — not
    // rem utilities like h-20/h-24, which scale with the 125%/110% root font and would
    // diverge from the loaded cards at one breakpoint.
    <div className="grid w-full min-w-0 grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-[100px] w-full touch:h-[96px]">
          <Card className="relative h-full min-h-[96px] w-full min-w-0 gap-0 overflow-visible py-0 border-l-2 border-l-border">
            <CardContent className="flex h-full items-center p-4">
              <div className="flex w-full min-w-0 items-center gap-3">
                <Skeleton className="size-8 shrink-0 rounded-md" />
                {/* Mirrors ItemCard's text column — same containers, same classes, so
                    line-heights are identical and items-center lands at the same offset. */}
                <div className="min-w-0 flex-1 overflow-hidden">
                  {/* <div className="flex items-center gap-1.5"><p className="font-medium"> */}
                  <div className="flex items-center gap-1.5">
                    <div className="relative min-w-0 flex-1 font-medium">
                      <span className="invisible select-none" aria-hidden="true">&nbsp;</span>
                      <Skeleton className="absolute inset-y-[20%] left-0 w-3/4 rounded-sm" />
                    </div>
                  </div>
                  {/* <p className="mt-0.5 line-clamp-2 text-xs"> — two lines */}
                  <div className="relative mt-0.5 text-xs">
                    <span className="invisible select-none" aria-hidden="true">&nbsp;</span>
                    <Skeleton className="absolute inset-y-[15%] left-0 w-full rounded-sm" />
                  </div>
                  <div className="relative text-xs">
                    <span className="invisible select-none" aria-hidden="true">&nbsp;</span>
                    <Skeleton className="absolute inset-y-[15%] left-0 w-2/3 rounded-sm" />
                  </div>
                  {/* <p className="mt-1 text-xs"> — date */}
                  <div className="relative mt-1 text-xs">
                    <span className="invisible select-none" aria-hidden="true">&nbsp;</span>
                    <Skeleton className="absolute inset-y-[15%] left-0 w-1/3 rounded-sm" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  )
}

export function CollectionCardSkeleton() {
  return (
    // Mirrors the loaded CollectionCard: size-10 icon tile + text column (name, description, meta row).
    <Card className="relative h-20 gap-0 overflow-visible py-0 border-l-2 border-l-muted/20">
      <CardContent className="flex h-full items-center gap-3 p-3 sm:p-4 pr-20">
        <Skeleton className="size-10 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="mt-1.5 h-3 w-full" />
          <div className="mt-1.5 flex items-center gap-3">
            <Skeleton className="h-3 w-12" />
            <div className="flex gap-1.5">
              <Skeleton className="size-3 rounded-full" />
              <Skeleton className="size-3 rounded-full" />
              <Skeleton className="size-3 rounded-full" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function ImageCardSkeleton() {
  return (
    <Card className="relative h-full min-w-0 w-full overflow-visible p-0">
      <div className="relative aspect-video h-full w-full overflow-hidden rounded-xl bg-muted/30">
        <Skeleton className="absolute inset-0 h-full w-full rounded-none" />
      </div>
    </Card>
  )
}

interface ImageGridSkeletonProps {
  count?: number
  itemHeight?: number
}

export function ImageGridSkeleton({ count = 6, itemHeight = 240 }: ImageGridSkeletonProps) {
  return (
    // Columns mirror the loaded image grid (getImageGridColumns): 2/3 at <1024/>=1024px.
    <div className="grid w-full min-w-0 grid-cols-2 gap-3 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ height: `${itemHeight}px`, width: '100%', minWidth: 0 }}>
          <ImageCardSkeleton />
        </div>
      ))}
    </div>
  )
}

export function FileRowSkeleton() {
  return (
    // Absolute px (grid itemHeight=48, touchItemHeight=64) — not rem h-10/h-16 which font-scale.
    <div className="w-full flex items-center gap-3 rounded-lg border border-border bg-muted px-4 py-2.5 h-[48px] touch:h-[64px]">
      <Skeleton className="size-5 shrink-0 rounded" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/2 mt-1.5 lg:hidden" />
      </div>
      <Skeleton className="hidden h-3 w-32 shrink-0 lg:block" />
      <Skeleton className="hidden h-3 w-16 shrink-0 lg:block" />
      <Skeleton className="hidden h-3 w-20 shrink-0 lg:block" />
      <Skeleton className="size-8 shrink-0 rounded" />
      <Skeleton className="size-8 shrink-0 rounded" />
    </div>
  )
}

interface FileListSkeletonProps {
  count?: number
  rowGap?: number
}

export function FileListSkeleton({ count = 6, rowGap = 10 }: FileListSkeletonProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: `${rowGap}px`, width: '100%', minWidth: 0 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-[48px] w-full touch:h-[64px]">
          <FileRowSkeleton />
        </div>
      ))}
    </div>
  )
}

interface ItemsTypeSkeletonProps {
  typeName: string
}

export function ItemsTypeSkeleton({ typeName }: ItemsTypeSkeletonProps) {
  if (ITEM_TYPES_WITH_IMAGE_GRID.has(typeName)) {
    return <ImageGridSkeleton />
  }
  if (ITEM_TYPES_WITH_FILE_LIST.has(typeName)) {
    return <FileListSkeleton />
  }
  return <CardGridSkeleton />
}
