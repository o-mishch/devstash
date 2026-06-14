'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SubmitButton } from '@/components/ui/button'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { PasswordFields } from '@/components/auth/password-fields'
import { post } from '@/lib/api/api-fetch'
import { useApiFormAction } from '@/hooks/use-api-form-action'
import type { AuthRedirectData } from '@/types/auth'

export function RegisterForm() {
  const router = useRouter()
  const { formAction, isPending } = useApiFormAction<AuthRedirectData>(
    (body) => post<AuthRedirectData>('/api/auth/register', body),
    {
      fallbackError: 'Registration failed.',
      onSuccess: (result) => { if (result.data?.redirectTo) router.push(result.data.redirectTo) },
    },
  )

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        <AuthFormField id="name" name="name" label="Name" type="text" placeholder="Brad Traversy" autoComplete="name" required />
        <AuthFormField id="email" name="email" label="Email" type="email" placeholder="you@example.com" autoComplete="email" required />
        <PasswordFields />

        <SubmitButton className="w-full" isPending={isPending}>
          Create account
        </SubmitButton>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href="/sign-in"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </>
  )
}
