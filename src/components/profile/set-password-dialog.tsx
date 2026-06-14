'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import { SubmitButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { useApiFormAction } from '@/hooks/use-api-form-action'
import { post } from '@/lib/api/api-fetch'
import { ProfileFormDialog } from './profile-form-dialog'

interface SetPasswordDialogProps {
  suggestedEmails: string[]
}

export function SetPasswordDialog({ suggestedEmails }: SetPasswordDialogProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  const onSuccess = useCallback(() => {
    toast.success('Password set. You can now sign in with email & password.')
    setOpen(false)
    router.refresh()
  }, [router])

  const { formAction, isPending } = useApiFormAction((body) => post('/api/profile/password', body), { onSuccess })

  return (
    <ProfileFormDialog
      title="Set a password"
      description="Add email & password sign-in to your account."
      triggerText="Set password"
      triggerIcon={<KeyRound className="mr-1 size-3" />}
      open={open}
      onOpenChange={setOpen}
    >
      {() => (
        <form action={formAction} className="space-y-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="email">Sign-in email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="off"
              list="set-password-email-list"
              required
            />
            <datalist id="set-password-email-list">
              {suggestedEmails.map((e) => <option key={e} value={e} />)}
            </datalist>
          </div>
          <AuthFormField
            id="newPassword"
            name="newPassword"
            label="New password"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
          <AuthFormField
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm password"
            type="password"
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />

          <SubmitButton className="w-full" isPending={isPending}>
            Set password
          </SubmitButton>
        </form>
      )}
    </ProfileFormDialog>
  )
}
