'use client'

import { Tag } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { AutoTagInput } from '@/components/items/auto-tag-input'
import type { ItemFormBaseValues } from '@/lib/utils/validators'

interface ItemTagsFieldProps {
  form: UseFormReturn<ItemFormBaseValues>
  error?: string
  isPro: boolean
  variant?: 'dialog' | 'drawer'
}

export function ItemTagsField({
  form,
  error,
  isPro,
  variant = 'dialog',
}: ItemTagsFieldProps) {
  if (variant === 'drawer') {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Tag className="size-3" />
          <span>Tags</span>
        </div>
        <AutoTagInput form={form} isPro={isPro} />
        {error && <p className="text-red-500 text-[10px]">{error}</p>}
        <p className="text-xs text-muted-foreground">Comma-separated</p>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      <label htmlFor="tags" className="text-sm font-medium leading-none">
        Tags
      </label>
      <AutoTagInput form={form} isPro={isPro} />
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
