'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { api } from '@/lib/api/client'
import { SubmitButton } from '@/components/ui/button'
import { useApiFormAction } from '@/hooks/use-api-form-action'

interface ConfirmEmailChangeFormProps {
  token: string
}

/**
 * Confirm form for the CHANGE flow: the user already has a password, so this only re-verifies the new
 * sign-in email. No fields — just a button that POSTs the token. Mirrors the add-flow confirm (same
 * endpoint), but submits no password because the server derives CHANGE from the current password state.
 */
export function ConfirmEmailChangeForm({ token }: ConfirmEmailChangeFormProps) {
  const router = useRouter()
  const { formAction, isPending } = useApiFormAction(
    async () => {
      const { error } = await api.POST('/auth/confirm-login-email', { body: { token } })
      if (error) throw new Error(error.message)
    },
    {
      onSuccess: () => {
        toast.success('Sign-in email updated. Use your new email to sign in next time.')
        router.push('/sign-in')
      },
    },
  )

  return (
    <form action={formAction} className="space-y-4">
      <SubmitButton className="w-full" isPending={isPending}>
        Confirm new sign-in email
      </SubmitButton>
    </form>
  )
}
