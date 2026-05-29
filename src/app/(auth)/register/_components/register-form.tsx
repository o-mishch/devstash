'use client'

import Link from 'next/link'
import { SubmitButton } from '@/components/ui/button'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { registerAction } from '@/actions/auth/register'
import { useActionStateWithToast } from '@/hooks/use-action-state-with-toast'

export function RegisterForm() {
  const { formAction, isPending } = useActionStateWithToast(registerAction, {
    fallbackError: 'Registration failed.'
  })

  return (
    <>
      <form action={formAction} className="flex flex-col gap-4">
        <AuthFormField id="name" name="name" label="Name" type="text" placeholder="Brad Traversy" autoComplete="name" required />
        <AuthFormField id="email" name="email" label="Email" type="email" placeholder="you@example.com" autoComplete="email" required />
        <AuthFormField id="password" name="password" label="Password" type="password" placeholder="••••••••" autoComplete="new-password" minLength={8} required />
        <AuthFormField id="confirmPassword" name="confirmPassword" label="Confirm password" type="password" placeholder="••••••••" autoComplete="new-password" minLength={8} required />

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
