'use client'

import Link from 'next/link'
import { useActionState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { signInWithCredentials, signInWithGitHub, resendVerificationEmail } from '@/actions/auth'

interface SignInFormProps {
  successMessage?: string
}

export function SignInForm({ successMessage }: SignInFormProps) {
  const router = useRouter()
  const [state, formAction, isPending] = useActionState(signInWithCredentials, {
    status: 'idle' as const,
  })

  useEffect(() => {
    if (successMessage) toast.success(successMessage)
  }, [successMessage])

  useEffect(() => {
    if (state.status === 'success') {
      toast.success('You successfully logged in.')
      router.push('/dashboard')
    } else if (state.status === 'error') {
      toast.error(state.message)
    }
  }, [state, router])

  async function handleResend() {
    const email = state.email
    if (!email) return
    const sent = await resendVerificationEmail(email)
    if (sent) {
      toast.success('Verification email sent. Check your inbox.')
    } else {
      toast.error('Failed to send verification email. Please try again later.')
    }
  }

  return (
    <div className="space-y-4">
      {state.status === 'unverified' && (
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
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
            Sign in
          </Button>
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

      <form action={signInWithGitHub}>
        <Button type="submit" variant="outline" className="w-full" disabled={isPending}>
          <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
          Continue with GitHub
        </Button>
      </form>
    </div>
  )
}
