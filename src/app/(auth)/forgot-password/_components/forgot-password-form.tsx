'use client'

import Link from 'next/link'
import { useState, type SyntheticEvent } from 'react'
import { toast } from 'sonner'
import { CircleCheck, Loader2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { apiFetch } from '@/lib/api-fetch'

export function ForgotPasswordForm() {
  const [isPending, setIsPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  async function handleSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsPending(true)

    const email = (e.currentTarget.elements.namedItem('email') as HTMLInputElement).value

    const data = await apiFetch('/api/auth/forgot-password', {
      method: 'POST',
      body: { email },
    })

    setIsPending(false)

    if (data.status === 'ok') {
      setSentTo(email)
    } else {
      toast.error(data.message ?? 'Something went wrong. Please try again.')
    }
  }

  if (sentTo) {
    return (
      <div className="w-full max-w-sm">
        <Card>
          <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10">
              <CircleCheck className="size-7 text-emerald-500" />
            </div>

            <div className="space-y-3">
              <p className="text-lg font-semibold">Check your email</p>
              <div className="space-y-1.5 text-sm text-muted-foreground">
                <p>
                  If <span className="font-medium text-foreground">{sentTo}</span> is registered,
                  we&apos;ve sent a password reset link to that address.
                </p>
                <p>The link will expire in 1 hour.</p>
                <p>Didn&apos;t receive the email? Check your spam folder or try again.</p>
              </div>
            </div>

            <div className="grid w-full grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => setSentTo(null)}>
                Try a different email
              </Button>
              <Link href="/sign-in" className={buttonVariants({ variant: 'outline' })}>
                Back to sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <Card>
        <CardContent className="space-y-6 p-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-bold">Forgot your password?</h1>
            <p className="text-sm text-muted-foreground">
              Enter your email and we&apos;ll send you a link to reset your password.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
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

            <div className="grid grid-cols-2 gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
                Send reset link
              </Button>
              <Link href="/sign-in" className={buttonVariants({ variant: 'outline' })}>
                Back to sign in
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
