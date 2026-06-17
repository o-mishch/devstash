import { Skeleton } from '@/components/ui/skeleton'

interface FavoritesListSkeletonProps {
  count?: number
}

// Flat compact rows — mirrors FavoriteCollectionRow (icon + name + badge + date,
// all visible). Used by the favorite collections tab.
export function FavoritesListSkeleton({ count = 6 }: FavoritesListSkeletonProps) {
  return (
    <div className="flex flex-col">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="app-row gap-3 rounded px-3 py-1.5 touch:py-3">
          <Skeleton className="size-3.5 shrink-0 rounded touch:size-5" />
          <Skeleton className="h-4 min-w-0 flex-1 touch:h-5" />
          <Skeleton className="h-4 w-16 shrink-0 rounded" />
          <Skeleton className="h-4 w-16 shrink-0 rounded" />
        </div>
      ))}
    </div>
  )
}

interface FavoriteItemsSkeletonProps {
  groups?: number
  rowsPerGroup?: number
}

// Grouped tree — mirrors FavoriteItemsList: a type header (chevron + icon + name +
// count badge) over indented leaf rows (FavoriteItemRow: badge hidden <sm, date hidden <md).
export function FavoriteItemsSkeleton({ groups = 3, rowsPerGroup = 3 }: FavoriteItemsSkeletonProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {[...Array(groups)].map((_, g) => (
        <div key={g}>
          <div className="flex items-center gap-2 px-3 py-1 touch:py-2">
            <Skeleton className="size-3 shrink-0 rounded touch:size-4" />
            <Skeleton className="size-3 shrink-0 rounded touch:size-4" />
            <Skeleton className="h-3 w-16 touch:h-4" />
            <Skeleton className="h-3 w-6 rounded" />
          </div>
          <div className="pl-4">
            {[...Array(rowsPerGroup)].map((_, r) => (
              <div key={r} className="app-row gap-3 rounded px-3 py-1.5 touch:py-3">
                <Skeleton className="size-3.5 shrink-0 rounded touch:size-5" />
                <Skeleton className="h-4 min-w-0 flex-1 touch:h-5" />
                <Skeleton className="hidden h-4 w-14 shrink-0 rounded sm:block" />
                <Skeleton className="hidden h-4 w-16 shrink-0 rounded md:block" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
