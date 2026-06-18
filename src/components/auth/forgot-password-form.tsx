'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { buttonVariants, SubmitButton } from '@/components/ui/button'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { api } from '@/lib/api/client'
import { useApiFormAction } from '@/hooks/use-api-form-action'

export function ForgotPasswordForm() {
  const router = useRouter()
  const { formAction, isPending } = useApiFormAction(
    async (body) => {
      const { data, error } = await api.POST('/auth/forgot-password', { body: { email: body.email } })
      if (error) throw new Error(error.message)
      return data
    },
    {
      onSuccess: (data) => { router.push(data.redirectTo) },
    },
  )

  return (
    <form action={formAction} className="space-y-4" suppressHydrationWarning>
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
