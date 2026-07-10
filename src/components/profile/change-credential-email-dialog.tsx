'use client'

import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import { SubmitButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { useApiFormAction } from '@/hooks/ui/use-api-form-action'
import { api } from '@/lib/api/client'
import { credentialEmailPrimaryMoveNote } from '@/lib/utils/auth'
import { ProfileFormDialog } from './profile-form-dialog'
import { usePatchUserProfile } from '@/hooks/profile/use-user-profile'

interface ChangeCredentialEmailDialogProps {
  currentEmail: string
  // True when changing the sign-in email also moves the primary User.email (in-sync account).
  alsoMovesPrimaryEmail: boolean
  verificationDisabled: boolean
  // Called only when the change applies immediately (verification disabled) so the parent store can
  // reflect the new sign-in email without waiting for the route handler's stale-while-revalidate cache.
  // Not called for the confirmation-link flow — nothing changes until the link is confirmed.
  onCredentialChanged: (email: string) => void
}

interface ChangeCredentialResult {
  email: string
  sentLink: boolean
}

// Fully static — no prop/state dependency — hoisted once at module scope rather than recreated per render.
const changeEmailTriggerIcon = <Pencil className="mr-1 size-3 max-sm:size-4" />

export function ChangeCredentialEmailDialog({ currentEmail, alsoMovesPrimaryEmail, verificationDisabled, onCredentialChanged }: ChangeCredentialEmailDialogProps) {
  const [emailError, setEmailError] = useState('')
  const patchUserProfile = usePatchUserProfile()

  // Verification enabled → a confirmation link is emailed to the new address and nothing changes until
  // it's confirmed. Verification disabled → the change applies instantly.
  const requiresConfirmationLink = !verificationDisabled

  const onSuccess = useCallback((result: ChangeCredentialResult) => {
    if (result.sentLink) {
      toast.success(`Confirmation link sent to ${result.email}. Click it to switch your sign-in email.`)
    } else {
      toast.success('Sign-in email updated.')
      // Patches the /profile cache (credentialEmail + available list, and the primary email when it moves
      // with the credential) via the ConnectedAccounts-supplied hook.
      onCredentialChanged(result.email)
      // When the primary email moves too, also patch /profile/me so the sidebar reflects it.
      if (alsoMovesPrimaryEmail) {
        patchUserProfile({ email: result.email })
      }
    }
  }, [onCredentialChanged, alsoMovesPrimaryEmail, patchUserProfile])

  // The form's `formAction` wrapper already validated email === confirmEmail before calling this.
  const { formAction: submitForm, isPending } = useApiFormAction<ChangeCredentialResult>(async (body) => {
    const email = body.email.trim().toLowerCase()
    const password = body.password

    const { error } = await api.POST('/profile/credential-email', { body: { email, password } })
    if (error) throw new Error(error.message)
    return { email, sentLink: requiresConfirmationLink }
  }, { onSuccess })

  const formAction = useCallback(async (formData: FormData) => {
    const email = (formData.get('email') as string ?? '').trim().toLowerCase()
    const confirm = (formData.get('confirmEmail') as string ?? '').trim().toLowerCase()
    if (email !== confirm) {
      setEmailError("Emails don't match. Please check and try again.")
      return
    }
    setEmailError('')
    await submitForm(formData)
  }, [submitForm])

  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) setEmailError('')
  }, [])

  const clearEmailError = useCallback(() => setEmailError(''), [])

  const primaryMoveNote = credentialEmailPrimaryMoveNote(alsoMovesPrimaryEmail)

  const description = (
    <>
      Current: <span className="font-medium text-foreground">{currentEmail}</span>
    </>
  )

  return (
    <ProfileFormDialog
      title="Change sign-in email"
      description={description}
      triggerText="Change email"
      triggerIcon={changeEmailTriggerIcon}
      triggerClassName="h-7 px-2 text-xs text-muted-foreground hover:text-foreground max-sm:h-10 max-sm:w-full max-sm:justify-start max-sm:px-3 max-sm:text-sm"
      onOpenChange={handleOpenChange}
    >
      {() => (
        <form action={formAction} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">New email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              autoComplete="off"
              required
              onChange={clearEmailError}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirmEmail">Confirm new email</Label>
            <Input
              id="confirmEmail"
              name="confirmEmail"
              type="email"
              placeholder="you@example.com"
              autoComplete="off"
              required
              onChange={clearEmailError}
            />
            {emailError && (
              <p className="text-xs text-destructive">{emailError}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <PasswordInput
              id="current-password"
              name="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
          </div>

          <p className="text-sm text-muted-foreground">
            {requiresConfirmationLink
              ? `We'll email a confirmation link to the new address — your sign-in email changes only after you confirm. Your password and linked accounts are unaffected.${primaryMoveNote}`
              : `This changes the email for your Email & Password sign-in only. Your password and linked accounts are unaffected.${primaryMoveNote}`}
          </p>

          <SubmitButton className="w-full" isPending={isPending}>
            {requiresConfirmationLink ? 'Send confirmation link' : 'Update email'}
          </SubmitButton>
        </form>
      )}
    </ProfileFormDialog>
  )
}
