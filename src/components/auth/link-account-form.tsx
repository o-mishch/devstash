'use client'

import { SubmitButton } from '@/components/ui/button'
import { AuthFormField } from '@/components/auth/auth-form-field'
import type { ApiBody } from '@/types/api'
import { useActionStateWithToast } from '@/hooks/use-action-state-with-toast'

interface LinkAccountFormProps {
  action: (_prev: ApiBody<null> | null, formData: FormData) => Promise<ApiBody<null>>
  providerLabel: string
}

export function LinkAccountForm({ action, providerLabel }: LinkAccountFormProps) {
  const { formAction, isPending } = useActionStateWithToast(action)

  return (
    <form action={formAction} className="space-y-4" suppressHydrationWarning>
      <AuthFormField id="password" name="password" label="Your DevStash password" type="password" placeholder="••••••••" autoComplete="current-password" autoFocus required />

      <SubmitButton className="w-full" isPending={isPending}>
        Link {providerLabel} account
      </SubmitButton>
    </form>
  )
}
