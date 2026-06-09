'use client'

import { useFormStatus } from 'react-dom'
import { Link as LinkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function AddProviderSubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0" disabled={pending}>
      <LinkIcon className="mr-1 size-3" />
      {pending ? 'Connecting...' : 'Link'}
    </Button>
  )
}
