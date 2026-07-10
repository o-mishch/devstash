'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button, SubmitButton, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { signInWithGitHub, signInWithGoogle } from '@/actions/auth/login'
import { api } from '@/lib/api/client'
import { ProviderIcon } from '@/components/shared/provider-icon'
import { WarningBanner } from '@/components/shared/warning-banner'

interface SignInFormProps {
  successMessage?: string
}

interface OAuthSubmitButtonProps {
  provider: string
  label: string
}

function OAuthSubmitButton({ provider, label }: OAuthSubmitButtonProps) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" className="w-full" disabled={pending}>
      <ProviderIcon provider={provider} className="size-4" />
      {pending ? 'Connecting...' : `Continue with ${label}`}
    </Button>
  )
}

export function SignInForm({ successMessage }: SignInFormProps) {
  const router = useRouter()
  // Set when login is blocked on an unverified email — renders the resend banner below.
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null)

  // Login routes through useMutation for the pending state; `<form action>` triggers it. The mutationFn
  // keeps the 3-way branching (success / 403-unverified-banner / error toast) and never throws, so the
  // form action resolves cleanly either way.
  const loginMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const email = formData.get('email')
      const password = formData.get('password')
      const { error } = await api.POST('/auth/login', {
        body: {
          email: typeof email === 'string' ? email : '',
          password: typeof password === 'string' ? password : '',
        },
      })

      if (!error) {
        setUnverifiedEmail(null)
        toast.success('You successfully logged in.')
        router.push('/dashboard')
        return
      }

      // Only the 403 "email not verified" error carries a structured `data.email`; `'data' in error`
      // narrows the error union to that member. Renders the resend banner below — no toast needed.
      if ('data' in error && error.data) {
        setUnverifiedEmail(error.data.email)
        return
      }

      setUnverifiedEmail(null)
      toast.error(error.message || 'Something went wrong. Please try again.')
    },
  })
  const { mutate: login, isPending } = loginMutation
  // Optimized using destructured stable `login` from useMutation.
  const formAction = useCallback(
    (formData: FormData) => login(formData),
    [login],
  )
  
  useEffect(() => {
    if (successMessage) toast.success(successMessage)
  }, [successMessage])

  const resendMutation = useMutation({
    mutationFn: async () => {
      // Throw rather than return early: a silent return would still fire onSuccess and toast "email sent"
      // without a send. (Unreachable today — the trigger only renders inside the `unverifiedEmail` banner.)
      if (!unverifiedEmail) throw new Error('No unverified email to resend to.')
      const { error } = await api.POST('/auth/resend-verification', { body: { email: unverifiedEmail } })
      if (error) throw new Error(error.message || 'Failed to send verification email. Please try again later.')
    },
    onSuccess: () => toast.success('Verification email sent. Check your inbox.'),
    onError: (error: Error) =>
      toast.error(error.message || 'Failed to send verification email. Please try again later.'),
  })

  const { mutate: resend } = resendMutation
  // Optimized using destructured stable `resend` from useMutation.
  const handleResendClick = useCallback(() => {
    resend()
  }, [resend])

  return (
    <div className="flex flex-col gap-4">
      {unverifiedEmail && (
        <WarningBanner>
          <p className="font-medium">Email not verified</p>
          <p className="mt-0.5 text-muted-foreground">
            Please check your inbox or{' '}
            <button
              type="button"
              onClick={handleResendClick}
              className="text-primary underline-offset-4 hover:underline"
            >
              resend the verification email
            </button>
            .
          </p>
        </WarningBanner>
      )}

      <form action={formAction} className="flex flex-col gap-4" suppressHydrationWarning>
        <AuthFormField id="email" name="email" label="Email" type="email" placeholder="you@example.com" autoComplete="email" required />
        <div className="flex flex-col gap-1.5" suppressHydrationWarning>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <PasswordInput
            id="password"
            name="password"
            placeholder="••••••••"
            autoComplete="off"
            required
          />
        </div>



        <div className="grid grid-cols-2 gap-2">
          <SubmitButton isPending={isPending}>
            Sign in
          </SubmitButton>
          <Link href="/register" className={cn(buttonVariants({ variant: 'secondary' }), "border border-border/50")}>
            Sign up
          </Link>
        </div>
      </form>

      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>

      <div className="flex flex-col gap-2">
        <form action={signInWithGitHub}>
          <OAuthSubmitButton provider="github" label="GitHub" />
        </form>
        <form action={signInWithGoogle}>
          <OAuthSubmitButton provider="google" label="Google" />
        </form>
      </div>
    </div>
  )
}
