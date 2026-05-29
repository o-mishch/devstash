import type { ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface AuthFormFieldProps extends ComponentProps<typeof Input> {
  id: string
  label: string
}

export function AuthFormField({ id, label, ...inputProps }: AuthFormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} {...inputProps} />
    </div>
  )
}
