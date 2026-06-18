'use client'

import { useId, useCallback } from 'react'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/lib/api/client'
import {
  AiDescriptionField,
  useAiDescriptionField,
  AI_DESCRIPTION_INPUT_CLASS,
} from '@/components/shared/ai-description-field'
import { AiFieldBadgeIfPro } from '@/components/shared/ai-field-chrome'
import { collectionFormSchema } from '@/lib/utils/validators'
import { cn } from '@/lib/utils'

type CollectionFormValues = z.input<typeof collectionFormSchema>

interface CollectionFormFieldsProps {
  form: UseFormReturn<CollectionFormValues>
  idPrefix?: string
  // When true the Description block fills the remaining height and its textarea grows with it —
  // used by the resizable mobile sheet so dragging the handle up enlarges the description area.
  growDescription?: boolean
}

export function CollectionFormFields({ form, idPrefix, growDescription = false }: CollectionFormFieldsProps) {
  const generatedId = useId()
  const prefix = idPrefix ?? generatedId
  const nameId = `${prefix}-name`
  const descId = `${prefix}-description`
  const { errors } = form.formState

  const name = useWatch({ control: form.control, name: 'name' }) ?? ''
  const canGenerate = name.trim().length > 0
  const disabledReason = canGenerate ? null : 'Enter a collection name first'

  const onGenerate = useCallback(async () => {
    const { data, error } = await api.POST('/ai/collection-description', { body: { name: name.trim() } })
    if (error) throw new Error(error.message)
    return data
  }, [name])

  const aiField = useAiDescriptionField({ canGenerate, disabledReason, onGenerate })
  const inputProps = form.register('description')

  return (
    <>
      <div className="grid shrink-0 gap-2">
        <Label htmlFor={nameId}>
          Name <span className="text-red-500">*</span>
        </Label>
        <Input
          id={nameId}
          placeholder="e.g. React Patterns"
          {...form.register('name')}
        />
        {errors.name && (
          <p className="text-xs text-red-500">{errors.name.message}</p>
        )}
      </div>
      <div className={cn('grid gap-2', growDescription && 'flex min-h-0 flex-1 flex-col')}>
        <Label htmlFor={descId} className="inline-flex shrink-0 items-center gap-2">
          Description
          <AiFieldBadgeIfPro
            onClick={aiField.run}
            disabled={aiField.disabled}
            tooltip={aiField.tooltip}
          />
        </Label>
        <AiDescriptionField
          field={aiField}
          onApply={(description) =>
            form.setValue('description', description, { shouldDirty: true, shouldValidate: true })
          }
          actionClassName="right-1.5 top-1.5"
          fill={growDescription}
        >
          <Textarea
            id={descId}
            placeholder="Optional description"
            rows={3}
            {...inputProps}
            className={cn(
              'resize-none',
              AI_DESCRIPTION_INPUT_CLASS,
              // growDescription: a low min so the sheet can shrink to a ~one-line Description; it
              // flex-fills to use whatever height the (resizable) sheet currently has.
              growDescription ? 'h-full min-h-10' : 'min-h-[5rem]',
            )}
          />
        </AiDescriptionField>
        {errors.description && (
          <p className="shrink-0 text-xs text-red-500">{errors.description.message}</p>
        )}
      </div>
    </>
  )
}
