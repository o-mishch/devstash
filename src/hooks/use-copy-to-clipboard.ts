import { useState, useCallback } from 'react'
import { toast } from 'sonner'

export function useCopyToClipboard(resetDelay = 2000) {
  const [isCopied, setIsCopied] = useState(false)

  const copy = useCallback(
    async (text: string) => {
      if (!navigator.clipboard || !(typeof window !== 'undefined' && window.isSecureContext)) {
        toast.error('Clipboard not available')
        return
      }
      try {
        await navigator.clipboard.writeText(text)
        setIsCopied(true)
        toast.success('Copied to clipboard')
        setTimeout(() => setIsCopied(false), resetDelay)
      } catch {
        toast.error('Failed to copy')
      }
    },
    [resetDelay],
  )

  return { isCopied, copy }
}
