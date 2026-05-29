'use client'

import { SubmitButton } from '@/components/ui/button'
import { AuthFormField } from '@/components/auth/auth-form-field'
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
      <AuthFormField id="password" name="password" label="New password" type="password" placeholder="••••••••" autoComplete="new-password" minLength={8} required />
      <AuthFormField id="confirmPassword" name="confirmPassword" label="Confirm password" type="password" placeholder="••••••••" autoComplete="new-password" minLength={8} required />

      <SubmitButton className="w-full" isPending={isPending}>
        Reset password
      </SubmitButton>
    </form>
  )
}
