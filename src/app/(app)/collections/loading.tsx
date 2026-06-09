
import { PageHeaderSkeleton, CollectionCardSkeleton } from '@/components/shared/skeletons'

const SKELETON_COUNT = 6

export default function CollectionsLoading() {
  return (
    <div className="app-page gap-6 p-6">
      <PageHeaderSkeleton actionWidthClass="w-36" />

      <div className="app-grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[...Array(SKELETON_COUNT)].map((_, i) => (
          <CollectionCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}
