'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { SubmitButton } from '@/components/ui/button'
import { PasswordFields } from '@/components/auth/password-fields'
import { post } from '@/lib/api/api-fetch'
import { useApiFormAction } from '@/hooks/use-api-form-action'

interface ResetPasswordFormProps {
  token: string
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter()
  const { formAction, isPending } = useApiFormAction(
    (body) => post('/api/auth/reset-password', { ...body, token }),
    {
      onSuccess: () => {
        toast.success('Password updated! You can now sign in.')
        router.push('/sign-in')
      },
    },
  )

  return (
    <form action={formAction} className="space-y-4">
      <PasswordFields passwordLabel="New password" />

      <SubmitButton className="w-full" isPending={isPending}>
        Reset password
      </SubmitButton>
    </form>
  )
}
