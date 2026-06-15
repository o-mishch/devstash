'use client'

import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { SubmitButton } from '@/components/ui/button'
import { PasswordFields } from '@/components/auth/password-fields'
import { orpcClient } from '@/lib/api/client'
import { useOrpcFormAction } from '@/hooks/use-orpc-form-action'

interface ResetPasswordFormProps {
  token: string
}

export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const router = useRouter()
  const { formAction, isPending } = useOrpcFormAction(
    (body) => orpcClient.auth.resetPassword({ token, password: body.password, confirmPassword: body.confirmPassword }),
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
