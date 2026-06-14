'use client'

import { useId, useCallback } from 'react'
import { useWatch, type UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { post } from '@/lib/api/api-fetch'
import {
  AiDescriptionField,
  AI_DESCRIPTION_INPUT_CLASS,
} from '@/components/shared/ai-description-field'
import { AiFieldBadgeIfPro } from '@/components/shared/ai-field-chrome'
import { collectionFormSchema } from '@/lib/utils/validators'

type CollectionFormValues = z.input<typeof collectionFormSchema>

interface CollectionFormFieldsProps {
  form: UseFormReturn<CollectionFormValues>
  idPrefix?: string
}

export function CollectionFormFields({ form, idPrefix }: CollectionFormFieldsProps) {
  const generatedId = useId()
  const prefix = idPrefix ?? generatedId
  const nameId = `${prefix}-name`
  const descId = `${prefix}-description`
  const { errors } = form.formState

  const name = useWatch({ control: form.control, name: 'name' }) ?? ''
  const canGenerate = name.trim().length > 0
  const disabledReason = canGenerate ? null : 'Enter a collection name first'

  const onGenerate = useCallback(
    () => post<{ description: string } | null>('/api/ai/collection-description', { name: name.trim() }),
    [name]
  )

  const inputProps = form.register('description')

  return (
    <>
      <div className="grid gap-2">
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
      <div className="grid gap-2">
        <Label htmlFor={descId} className="inline-flex items-center gap-2">
          Description
          <AiFieldBadgeIfPro />
        </Label>
        <AiDescriptionField
          canGenerate={canGenerate}
          disabledReason={disabledReason}
          onGenerate={onGenerate}
          onApply={(description) =>
            form.setValue('description', description, { shouldDirty: true, shouldValidate: true })
          }
          actionClassName="right-1.5 top-1.5"
        >
          <Textarea
            id={descId}
            placeholder="Optional description"
            rows={3}
            {...inputProps}
            className={`min-h-[5rem] resize-none ${AI_DESCRIPTION_INPUT_CLASS}`}
          />
        </AiDescriptionField>
        {errors.description && (
          <p className="text-xs text-red-500">{errors.description.message}</p>
        )}
      </div>
    </>
  )
}
