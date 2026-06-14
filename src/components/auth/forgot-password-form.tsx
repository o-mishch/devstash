'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { buttonVariants, SubmitButton } from '@/components/ui/button'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { post } from '@/lib/api/api-fetch'
import { useApiFormAction } from '@/hooks/use-api-form-action'
import type { AuthRedirectData } from '@/types/auth'

export function ForgotPasswordForm() {
  const router = useRouter()
  const { formAction, isPending } = useApiFormAction<AuthRedirectData>(
    (body) => post<AuthRedirectData>('/api/auth/forgot-password', body),
    {
      onSuccess: (result) => { if (result.data?.redirectTo) router.push(result.data.redirectTo) },
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
