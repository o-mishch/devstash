import { useState, useCallback } from 'react'
import { toast } from 'sonner'

export function useCopyToClipboard(resetDelay = 2000) {
  const [isCopied, setIsCopied] = useState(false)

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setIsCopied(true)
      toast.success('Copied to clipboard')
      setTimeout(() => setIsCopied(false), resetDelay)
    } catch {
      // clipboard write failed silently
    }
  }, [resetDelay])

  return { isCopied, copy }
}
