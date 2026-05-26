'use client'

import Link from 'next/link'
import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { registerAction } from '@/actions/auth'

export function RegisterForm() {
  const [state, formAction, isPending] = useActionState(registerAction, null)

  useEffect(() => {
    if (!state) return
    if (state.status !== 'ok') toast.error(state.message ?? 'Registration failed.')
  }, [state])

  return (
    <>
      <form action={formAction} className="space-y-4">
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
            minLength={8}
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
            minLength={8}
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
