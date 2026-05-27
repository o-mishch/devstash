'use client'

import Link from 'next/link'
import { buttonVariants, SubmitButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { forgotPasswordAction } from '@/actions/auth/reset'
import { useActionStateWithToast } from '@/hooks/use-action-state-with-toast'

export function ForgotPasswordForm() {
  const { formAction, isPending } = useActionStateWithToast(forgotPasswordAction)

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <SubmitButton isPending={isPending}>
          Send reset link
        </SubmitButton>
        <Link href="/sign-in" className={buttonVariants({ variant: 'outline' })}>
          Back to sign in
        </Link>
      </div>
    </form>
  )
}
