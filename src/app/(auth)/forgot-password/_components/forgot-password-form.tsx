'use client'

import Link from 'next/link'
import { buttonVariants, SubmitButton } from '@/components/ui/button'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { forgotPasswordAction } from '@/actions/auth/reset'
import { useActionStateWithToast } from '@/hooks/use-action-state-with-toast'

export function ForgotPasswordForm() {
  const { formAction, isPending } = useActionStateWithToast(forgotPasswordAction)

  return (
    <form action={formAction} className="space-y-4">
      <AuthFormField id="email" name="email" label="Email" type="email" placeholder="you@example.com" autoComplete="email" required />

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
