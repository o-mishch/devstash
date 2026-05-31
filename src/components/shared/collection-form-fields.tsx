'use client'

import { useId } from 'react'
import type { UseFormRegister, FieldErrors } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface CollectionFormValues {
  name: string
  description?: string | null
}

interface CollectionFormFieldsProps {
  register: UseFormRegister<CollectionFormValues>
  errors: FieldErrors<CollectionFormValues>
  idPrefix?: string
}

export function CollectionFormFields({ register, errors, idPrefix }: CollectionFormFieldsProps) {
  const generatedId = useId()
  const prefix = idPrefix ?? generatedId
  const nameId = `${prefix}-name`
  const descId = `${prefix}-description`

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={nameId}>
          Name <span className="text-red-500">*</span>
        </Label>
        <Input
          id={nameId}
          placeholder="e.g. React Patterns"
          {...register('name')}
        />
        {errors.name && (
          <p className="text-xs text-red-500">{errors.name.message}</p>
        )}
      </div>
      <div className="grid gap-2">
        <Label htmlFor={descId}>Description</Label>
        <Textarea
          id={descId}
          placeholder="Optional description"
          className="resize-none"
          rows={3}
          {...register('description')}
        />
        {errors.description && (
          <p className="text-xs text-red-500">{errors.description.message}</p>
        )}
      </div>
    </>
  )
}
