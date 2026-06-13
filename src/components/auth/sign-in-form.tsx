'use client'

import Link from 'next/link'
import { useActionState, useEffect } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button, SubmitButton, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { signInWithCredentials, signInWithGitHub, signInWithGoogle } from '@/actions/auth/login'
import { post } from '@/lib/api/api-fetch'
import { ProviderIcon } from '@/components/shared/provider-icon'
import { WarningBanner } from '@/components/shared/warning-banner'

interface SignInFormProps {
  successMessage?: string
}

interface ResendResponse {
  email: string
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

    const data = await post<ResendResponse>('/api/auth/resend-verification', { email })

    if (data.status === 'ok') {
      toast.success('Verification email sent. Check your inbox.')
    } else {
      toast.error(data.message ?? 'Failed to send verification email. Please try again later.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {state?.status === 'forbidden' && (
        <WarningBanner>
          <p className="font-medium">Email not verified</p>
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
        </WarningBanner>
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
