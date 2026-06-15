'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { buttonVariants, SubmitButton } from '@/components/ui/button'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { orpcClient } from '@/lib/api/client'
import { useOrpcFormAction } from '@/hooks/use-orpc-form-action'

export function ForgotPasswordForm() {
  const router = useRouter()
  const { formAction, isPending } = useOrpcFormAction(
    (body) => orpcClient.auth.forgotPassword({ email: body.email }),
    {
      onSuccess: (data) => { router.push(data.redirectTo) },
    },
  )

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
