'use client'

import { SubmitButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ApiBody } from '@/types/api'
import { useActionStateWithToast } from '@/hooks/use-action-state-with-toast'

interface LinkAccountFormProps {
  action: (_prev: ApiBody<null> | null, formData: FormData) => Promise<ApiBody<null>>
}

export function LinkAccountForm({ action }: LinkAccountFormProps) {
  const { formAction, isPending } = useActionStateWithToast(action)

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

      <SubmitButton className="w-full" isPending={isPending}>
        Link GitHub account
      </SubmitButton>
    </form>
  )
}
