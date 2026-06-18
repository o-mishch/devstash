import type { ComponentProps } from 'react'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'

interface AuthFormFieldProps extends ComponentProps<typeof Input> {
  id: string
  label: string
}

export function AuthFormField({ id, label, type, ...inputProps }: AuthFormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5" suppressHydrationWarning>
      <Label htmlFor={id}>{label}</Label>
      {type === 'password' ? (
        <PasswordInput id={id} {...inputProps} />
      ) : (
        <Input id={id} type={type} {...inputProps} />
      )}
    </div>
  )
}
