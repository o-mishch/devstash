import { useEffect } from 'react'
import { useIntersectionObserver } from '@/hooks/use-intersection-observer'

export function useAutoFetchNextPage(
  hasNextPage: boolean | undefined,
  isFetchingNextPage: boolean,
  fetchNextPage: () => unknown,
) {
  const { ref: sentinelRef, inView } = useIntersectionObserver({ rootMargin: '200px' })

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage])

  return { sentinelRef }
}
