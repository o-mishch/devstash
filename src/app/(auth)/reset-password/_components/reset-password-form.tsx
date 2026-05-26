'use client'

import { SubmitButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          placeholder="••••••••"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>

      <SubmitButton className="w-full" isPending={isPending}>
        Reset password
      </SubmitButton>
    </form>
  )
}
