'use client'

import { useState, useTransition, type SubmitEvent as ReactSubmitEvent } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import { SubmitButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { api } from '@/lib/api/client'
import { ProfileFormDialog } from './profile-form-dialog'
import { WarningBanner } from '@/components/shared/warning-banner'

interface ChangeCredentialEmailDialogProps {
  currentEmail: string
}

export function ChangeCredentialEmailDialog({ currentEmail }: ChangeCredentialEmailDialogProps) {
  const [emailError, setEmailError] = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function handleOpenChange(next: boolean) {
    if (!next) setEmailError('')
  }

  function createSubmitHandler(closeDialog: () => void) {
    return (e: ReactSubmitEvent<HTMLFormElement>) => {
      e.preventDefault()
      const data = new FormData(e.currentTarget)
      const email = (data.get('email') as string ?? '').trim().toLowerCase()
      const confirm = (data.get('confirmEmail') as string ?? '').trim().toLowerCase()

      if (email !== confirm) {
        setEmailError("Emails don't match. Please check and try again.")
        return
      }

      setEmailError('')

      startTransition(async () => {
        const { error } = await api.PATCH('/profile/email', { body: { email, password: String(data.get('password') ?? '') } })
        if (!error) {
          toast.warning('Sign-in email updated. Use your new email to sign in next time.')
          closeDialog()
          router.refresh()
        } else {
          toast.error(error.message || 'Failed to update email.')
        }
      })
    }
  }

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
      triggerIcon={<Pencil className="mr-1 size-3 max-sm:size-4" />}
      triggerClassName="h-7 px-2 text-xs text-muted-foreground hover:text-foreground max-sm:h-10 max-sm:w-full max-sm:justify-start max-sm:px-3 max-sm:text-sm"
      onOpenChange={handleOpenChange}
    >
      {({ closeDialog }) => (
        <>
          <WarningBanner>
            After saving, use your <strong>new email</strong> to sign in next time.
          </WarningBanner>

          <form onSubmit={createSubmitHandler(closeDialog)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">New email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                autoComplete="off"
                required
                onChange={() => setEmailError('')}
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
                onChange={() => setEmailError('')}
              />
              {emailError && (
                <p className="text-xs text-destructive">{emailError}</p>
              )}
            </div>

            <AuthFormField
              id="password"
              name="password"
              label="Confirm with your password"
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />

            <SubmitButton className="w-full" isPending={isPending}>
              Update email
            </SubmitButton>
          </form>
        </>
      )}
    </ProfileFormDialog>
  )
}
