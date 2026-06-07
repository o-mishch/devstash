'use client'

import { SubmitButton } from '@/components/ui/button'
import { PasswordFields } from '@/components/auth/password-fields'
import type { ApiBody } from '@/types/api'
import { useActionStateWithToast } from '@/hooks/use-action-state-with-toast'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

interface ResetPasswordFormProps {
  action: (_prev: ApiBody<null> | null, formData: FormData) => Promise<ApiBody<null>>
}

export function ResetPasswordForm({ action }: ResetPasswordFormProps) {
  const router = useRouter()
  const { formAction, isPending } = useActionStateWithToast(action, {
    onSuccess: () => {
      toast.success('Password updated! You can now sign in.')
      router.push('/sign-in')
    }
  })

  return (
    <form action={formAction} className="space-y-4">
      <PasswordFields passwordLabel="New password" />

      <SubmitButton className="w-full" isPending={isPending}>
        Reset password
      </SubmitButton>
    </form>
  )
}
