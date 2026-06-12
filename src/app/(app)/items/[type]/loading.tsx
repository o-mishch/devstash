import { ItemsPageSkeleton } from '@/components/shared/skeletons'

export default function ItemsLoading() {
  // Router-level loading state fallback
  // Type-specific skeleton is determined by the page component via Suspense
  return <ItemsPageSkeleton />
}
