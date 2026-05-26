'use client'

import { useActionState, useEffect } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ApiBody } from '@/types/api'

interface LinkAccountFormProps {
  action: (_prev: ApiBody<null> | null, formData: FormData) => Promise<ApiBody<null>>
}

export function LinkAccountForm({ action }: LinkAccountFormProps) {
  const [state, formAction, isPending] = useActionState(action, null)

  // linkAccountAction ends with signIn(..., { redirectTo: '/dashboard' }), which always
  // throws NEXT_REDIRECT server-side — the action never returns status 'ok' to the client.
  // Only error responses reach here.
  useEffect(() => {
    if (!state) return
    toast.error(state.message ?? 'Something went wrong. Please try again.')
  }, [state])

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">Your DevStash password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          autoComplete="current-password"
          autoFocus
          required
        />
      </div>

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending && <Loader2 className="mr-1 size-4 animate-spin" />}
        Link GitHub account
      </Button>
    </form>
  )
}
