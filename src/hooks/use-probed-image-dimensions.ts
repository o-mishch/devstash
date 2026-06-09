'use client'

import { useEffect, useState } from 'react'
import {
  probeImageDimensionsFromUrl,
  type ImageDimensions,
} from '@/lib/utils/image-dimensions.client'

interface DimensionState {
  url: string
  dimensions: ImageDimensions
}

export function useProbedImageDimensions(
  imageUrl: string | null | undefined,
  enabled: boolean
): ImageDimensions | null {
  const activeUrl = enabled && imageUrl ? imageUrl : null
  const [state, setState] = useState<DimensionState | null>(null)

  useEffect(() => {
    if (!activeUrl) return

    let cancelled = false

    void probeImageDimensionsFromUrl(activeUrl).then((dimensions) => {
      if (cancelled) return
      if (dimensions) {
        setState({ url: activeUrl, dimensions })
      } else {
        setState(null)
      }
    })

    return () => {
      cancelled = true
    }
  }, [activeUrl])

  if (!activeUrl || state?.url !== activeUrl) return null
  return state.dimensions
}
