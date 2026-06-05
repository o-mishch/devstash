'use client'

import { type MouseEvent } from 'react'
import { Copy, Check, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { useRestrictedAction } from '@/hooks/use-restricted-action'
import { cn } from '@/lib/utils'

interface CopyButtonProps {
  value: string
  className?: string
  iconClassName?: string
  stopPropagation?: boolean
  title?: string
  text?: string
  isRestricted?: boolean
  restrictedDescription?: string
  onUpgrade?: () => void
}

export function CopyButton({
  value,
  className,
  iconClassName = 'size-4',
  stopPropagation = false,
  title = 'Copy',
  text,
  isRestricted = false,
  restrictedDescription = 'Copying download links requires a Pro plan.',
  onUpgrade,
}: CopyButtonProps) {
  const { isCopied, copy } = useCopyToClipboard()
  const { showError, flash } = useRestrictedAction({
    title: 'Pro feature',
    description: restrictedDescription,
    onUpgrade,
  })

  function handleClick(e: MouseEvent) {
    if (stopPropagation) e.stopPropagation()
    if (isRestricted) {
      e.preventDefault()
      flash()
      return
    }
    copy(value)
  }

  return (
    <Button size={text ? 'sm' : 'icon'} variant="ghost" className={cn(!text && 'size-7', className)} onClick={handleClick} title={title}>
      {showError ? <XCircle className={cn(iconClassName, 'text-destructive')} /> : isCopied ? <Check className={cn(iconClassName, 'text-green-400')} /> : <Copy className={iconClassName} />}
      {text}
    </Button>
  )
}
