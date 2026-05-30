'use client'

import type { MouseEvent } from 'react'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { cn } from '@/lib/utils'

interface CopyButtonProps {
  value: string
  className?: string
  iconClassName?: string
  stopPropagation?: boolean
  title?: string
}

export function CopyButton({
  value,
  className,
  iconClassName = 'size-4',
  stopPropagation = false,
  title = 'Copy',
}: CopyButtonProps) {
  const { isCopied, copy } = useCopyToClipboard()

  function handleClick(e: MouseEvent) {
    if (stopPropagation) e.stopPropagation()
    copy(value)
  }

  return (
    <Button size="icon" variant="ghost" className={cn('size-7', className)} onClick={handleClick} title={title}>
      {isCopied ? <Check className={cn(iconClassName, 'text-green-400')} /> : <Copy className={iconClassName} />}
    </Button>
  )
}
