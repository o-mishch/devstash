'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiFetch } from '@/lib/api-fetch'
import type { VerificationResult } from '@/lib/emails/verification'

interface RegisterResponseData {
  verification: VerificationResult
}

interface PostRegState {
  email: string
  emailSent: boolean
}

export function RegisterForm() {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [postReg, setPostReg] = useState<PostRegState | null>(null)

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)

    const name = formData.get('name') as string
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const confirmPassword = formData.get('confirmPassword') as string

    if (password !== confirmPassword) {
      toast.error('Passwords do not match.')
      return
    }

    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.')
      return
    }

    setIsPending(true)

    const data = await apiFetch<RegisterResponseData>('/api/auth/register', {
      method: 'POST',
      body: { name, email, password },
    })

    setIsPending(false)

    if (data.status !== 'ok') {
      toast.error(data.message ?? 'Registration failed.')
      return
    }

    if (data.data?.verification === 'skipped') {
      toast.success('Account created! You can sign in now.')
      router.push('/sign-in')
      return
    }

    setPostReg({ email, emailSent: data.data?.verification === 'sent' })
  }

  if (postReg) {
    return (
      <div className="space-y-4">
        <p className="text-center text-sm text-muted-foreground">
          {postReg.emailSent ? (
            <>
              We sent a verification link to{' '}
              <span className="font-medium text-foreground">{postReg.email}</span>.
              Click it to activate your account.
            </>
          ) : (
            <>
              Your account was created, but we couldn&apos;t send the verification email to{' '}
              <span className="font-medium text-foreground">{postReg.email}</span>.
              Sign in and request a new verification link.
            </>
          )}
        </p>
        <Link href="/sign-in" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
          Go to sign in
        </Link>
      </div>
    )
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            placeholder="Brad Traversy"
            autoComplete="name"
            required
          />
        </div>
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
            autoComplete="new-password"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
          Create account
        </Button>
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
