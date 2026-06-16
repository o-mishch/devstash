'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { SubmitButton } from '@/components/ui/button'
import { PasswordFields } from '@/components/auth/password-fields'
import { api } from '@/lib/api/client'
import { useApiFormAction } from '@/hooks/use-api-form-action'

interface ResetPasswordFormProps {
  token: string
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter()
  const { formAction, isPending } = useApiFormAction(
    async (body) => {
      const { error } = await api.POST('/auth/reset-password', {
        body: { token, password: body.password, confirmPassword: body.confirmPassword },
      })
      if (error) throw new Error(error.message)
    },
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
