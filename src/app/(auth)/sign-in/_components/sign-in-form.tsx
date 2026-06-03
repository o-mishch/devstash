'use client'

import Link from 'next/link'
import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button, SubmitButton, buttonVariants } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { signInWithCredentials, signInWithGitHub, signInWithGoogle } from '@/actions/auth/login'
import { apiFetch } from '@/lib/api-fetch'
import { ProviderIcon } from '@/components/shared/provider-icon'

interface SignInFormProps {
  successMessage?: string
}

interface ResendResponse {
  email: string
}

function GitHubSubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" className="w-full" disabled={pending}>
      <ProviderIcon provider="github" className="size-4" />
      {pending ? 'Connecting...' : 'Continue with GitHub'}
    </Button>
  )
}

function GoogleSubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="outline" className="w-full" disabled={pending}>
      <ProviderIcon provider="google" className="size-4" />
      {pending ? 'Connecting...' : 'Continue with Google'}
    </Button>
  )
}

export function SignInForm({ successMessage }: SignInFormProps) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(signInWithCredentials, null)

  useEffect(() => {
    if (successMessage) toast.success(successMessage)
  }, [successMessage])

  useEffect(() => {
    if (!state) return
    if (state.status === 'ok') {
      toast.success('You successfully logged in.')
      router.push('/dashboard')
    } else if (state.status !== 'forbidden') {
      // 'forbidden' renders the "email not verified" banner below — no toast needed
      toast.error(state.message ?? 'Something went wrong. Please try again.')
    }
  }, [state, router])

  async function handleResend() {
    const email = state?.data?.email
    if (!email) return

    const data = await apiFetch<ResendResponse>('/api/auth/resend-verification', {
      method: 'POST',
      body: { email },
    })

    if (data.status === 'ok') {
      toast.success('Verification email sent. Check your inbox.')
    } else {
      toast.error(data.message ?? 'Failed to send verification email. Please try again later.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {state?.status === 'forbidden' && (
        <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-yellow-600 dark:text-yellow-400">Email not verified</p>
          <p className="mt-0.5 text-muted-foreground">
            Please check your inbox or{' '}
            <button
              type="button"
              onClick={handleResend}
              className="text-primary underline-offset-4 hover:underline"
            >
              resend the verification email
            </button>
            .
          </p>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <AuthFormField id="email" name="email" label="Email" type="email" placeholder="you@example.com" autoComplete="email" required />
        <div className="flex flex-col gap-1.5">
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
            autoComplete="current-password"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <SubmitButton isPending={isPending}>
            Sign in
          </SubmitButton>
          <Link href="/register" className={buttonVariants({ variant: 'outline' })}>
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
          <GitHubSubmitButton />
        </form>
        <form action={signInWithGoogle}>
          <GoogleSubmitButton />
        </form>
      </div>
    </div>
  )
}
