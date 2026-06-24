'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { KeyRound } from 'lucide-react'
import { SubmitButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { useApiFormAction } from '@/hooks/ui/use-api-form-action'
import { api } from '@/lib/api/client'
import { ProfileFormDialog } from './profile-form-dialog'

interface SetPasswordDialogProps {
  suggestedEmails: string[]
  verificationDisabled: boolean
  // Called when the login is activated immediately (owned email, or instant activation) so the parent
  // can show the new row without waiting for the route handler's stale-while-revalidate cache to catch
  // up. Not called for the 'requested' (confirmation-link) flow — nothing changes until confirmed.
  onCredentialAdded: (email: string) => void
}

interface SetPasswordResult {
  mode: 'set' | 'requested'
  email: string
}

export function SetPasswordDialog({ suggestedEmails, verificationDisabled, onCredentialAdded }: SetPasswordDialogProps) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')

  const normalizedEmail = email.trim().toLowerCase()
  // The flow is driven solely by DISABLE_EMAIL_VERIFICATION. Verification enabled → a confirmation link
  // is emailed to the address and the password is chosen on the confirm page (email-only dialog).
  // Verification disabled → the password is collected here and the login activates instantly.
  const requiresConfirmationLink = !verificationDisabled

  const onSuccess = useCallback((result: SetPasswordResult) => {
    if (result.mode === 'requested') {
      toast.success(`Confirmation link sent to ${result.email}. Click it to finish adding sign-in.`)
    } else {
      toast.success('Email & Password sign-in added. You can now sign in with this email and password.')
      // Reflect the new login row immediately — the server re-render lags behind the route handler's
      // stale-while-revalidate cache invalidation.
      onCredentialAdded(result.email)
    }
    setOpen(false)
    setEmail('')
  }, [onCredentialAdded])

  const { formAction, isPending } = useApiFormAction<SetPasswordResult>(async (body) => {
    // The email input is controlled by `email`, so `normalizedEmail` is the submitted value. Adding a
    // credential login always goes through /profile/credential-email — the server only ever writes
    // credentialEmail, never User.email. Verification enabled sends a link (password chosen on the
    // confirm page); verification disabled activates instantly from the password collected here.
    if (requiresConfirmationLink) {
      const { error } = await api.POST('/profile/credential-email', { body: { email: normalizedEmail } })
      if (error) throw new Error(error.message)
      return { mode: 'requested', email: normalizedEmail }
    }
    const { error } = await api.POST('/profile/credential-email', {
      body: { email: normalizedEmail, newPassword: body.newPassword, confirmPassword: body.confirmPassword },
    })
    if (error) throw new Error(error.message)
    return { mode: 'set', email: normalizedEmail }
  }, { onSuccess })

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (!next) setEmail('')
  }, [])

  return (
    <ProfileFormDialog
      title="Add Email & Password sign-in"
      description="Create an email & password login for your account — pick the email you'll sign in with."
      triggerText="Set up"
      triggerIcon={<KeyRound className="mr-1 size-3" />}
      open={open}
      onOpenChange={handleOpenChange}
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <datalist id="set-password-email-list">
              {suggestedEmails.map((e) => <option key={e} value={e} />)}
            </datalist>
          </div>

          {requiresConfirmationLink ? (
            <p className="text-sm text-muted-foreground">
              We&apos;ll send a confirmation link to this address — click it to set your password and
              finish adding sign-in. Nothing changes until you confirm.
            </p>
          ) : (
            <>
              <AuthFormField
                id="newPassword"
                name="newPassword"
                label="New password"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                minLength={8}
                required
              />
              <AuthFormField
                id="confirmPassword"
                name="confirmPassword"
                label="Confirm password"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </>
          )}

          <SubmitButton className="w-full" isPending={isPending}>
            {requiresConfirmationLink ? 'Send confirmation link' : 'Set password'}
          </SubmitButton>
        </form>
      )}
    </ProfileFormDialog>
  )
}
