'use client'

import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { SubmitButton } from '@/components/ui/button'
import { AuthFormField } from '@/components/auth/auth-form-field'
import type { ActionState } from '@/types/actions'

interface LinkAccountFormProps {
  action: (_prev: ActionState | null, formData: FormData) => Promise<ActionState>
  providerLabel: string
}

export function LinkAccountForm({ action, providerLabel }: LinkAccountFormProps) {
  const [state, formAction, isPending] = useActionState(action, null)

  useEffect(() => {
    if (state && !state.success) {
      toast.error(state.message ?? 'Something went wrong. Please try again.')
    }
  }, [state])

  return (
    <form action={formAction} className="space-y-4" suppressHydrationWarning>
      <AuthFormField id="password" name="password" label="Your DevStash password" type="password" placeholder="••••••••" autoComplete="current-password" autoFocus required />

      <SubmitButton className="w-full" isPending={isPending}>
        Link {providerLabel} account
      </SubmitButton>
    </form>
  )
}
