'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { SubmitButton } from '@/components/ui/button'
import { PasswordFields } from '@/components/auth/password-fields'
import { useApiFormAction } from '@/hooks/use-api-form-action'

// Both token-confirm endpoints share the same `{ token, password, confirmPassword }` body, so the
// path can be passed in (serializable from the server-component page) without losing type safety.
type TokenConfirmPath = '/auth/reset-password' | '/auth/confirm-login-email'

interface TokenPasswordFormProps {
  token: string
  path: TokenConfirmPath
  successMessage: string
  passwordLabel: string
  submitLabel: string
}

/** Shared token-confirm form: collect a new password, POST it with the token, toast, redirect to sign-in. */
export function TokenPasswordForm({ token, path, successMessage, passwordLabel, submitLabel }: TokenPasswordFormProps) {
  const router = useRouter()
  const { formAction, isPending } = useApiFormAction(
    async (body) => {
      const { error } = await api.POST(path, {
        body: { token, password: body.password, confirmPassword: body.confirmPassword },
      })
      if (error) throw new Error(error.message)
    },
    {
      onSuccess: () => {
        toast.success(successMessage)
        router.push('/sign-in')
      },
    },
  )

  return (
    <form action={formAction} className="space-y-4" suppressHydrationWarning>
      <PasswordFields passwordLabel={passwordLabel} />

      <SubmitButton className="w-full" isPending={isPending}>
        {submitLabel}
      </SubmitButton>
    </form>
  )
}
