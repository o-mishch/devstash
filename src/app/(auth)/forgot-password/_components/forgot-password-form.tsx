'use client'

import Link from 'next/link'
import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { forgotPasswordAction } from '@/actions/auth'

export function ForgotPasswordForm() {
  const [state, formAction, isPending] = useActionState(forgotPasswordAction, null)

  useEffect(() => {
    if (!state) return
    if (state.status !== 'ok') toast.error(state.message ?? 'Something went wrong. Please try again.')
  }, [state])

  return (
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
  )
}
