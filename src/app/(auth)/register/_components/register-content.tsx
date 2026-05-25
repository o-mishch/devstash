'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'

import { Loader2, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthLogo } from '@/components/auth/auth-logo'
import { StatusCard } from '@/components/auth/status-card'
import type { VerificationResult } from '@/lib/emails/verification'
import type { ApiResponse } from '@/types/api'

type RegisterResponse = ApiResponse<{ verification: VerificationResult }>
type PostRegState = { email: string; emailSent: boolean } | null

export function RegisterContent() {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [postReg, setPostReg] = useState<PostRegState>(null)

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

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })

      const data: RegisterResponse = await res.json()

      if (!data.success) {
        toast.error(data.message ?? 'Registration failed.')
        return
      }

      if (data.verification === 'skipped') {
        toast.success('Account created! You can sign in now.')
        router.push('/sign-in')
        return
      }

      setPostReg({ email, emailSent: data.verification === 'sent' })
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setIsPending(false)
    }
  }

  if (postReg) {
    if (!postReg.emailSent) {
      return (
        <StatusCard
          variant="error"
          title="Couldn't send verification email"
          description={
            <>
              Your account was created, but we failed to send the verification email to{' '}
              <span className="font-medium text-foreground">{postReg.email}</span>.
              Please sign in and request a new verification link.
            </>
          }
          action={{ label: 'Go to sign in', href: '/sign-in' }}
        />
      )
    }

    return (
      <StatusCard
        icon={Mail}
        title="Check your inbox"
        description={
          <>
            We sent a verification link to{' '}
            <span className="font-medium text-foreground">{postReg.email}</span>.
            Click it to activate your account.
          </>
        }
        action={{ label: 'Back to sign in', href: '/sign-in' }}
      />
    )
  }

  return (
    <>
      <div className="flex flex-col items-center gap-2 text-center">
        <AuthLogo />
        <h1 className="text-2xl font-bold">Create an account</h1>
        <p className="text-sm text-muted-foreground">
          Get started with your developer knowledge hub.
        </p>
      </div>

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
