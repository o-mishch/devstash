'use client'

import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ApiBody } from '@/types/api'

interface ResetPasswordFormProps {
  action: (_prev: ApiBody<null> | null, formData: FormData) => Promise<ApiBody<null>>
}

export function ResetPasswordForm({ action }: ResetPasswordFormProps) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(action, null)

  useEffect(() => {
    if (!state) return
    if (state.status === 'ok') {
      toast.success('Password updated! You can now sign in.')
      router.push('/sign-in')
    } else {
      toast.error(state.message ?? 'Something went wrong. Please try again.')
    }
  }, [state, router])

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

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
        Reset password
      </Button>
    </form>
  )
}
