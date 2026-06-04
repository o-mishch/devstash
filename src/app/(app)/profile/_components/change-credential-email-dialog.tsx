'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil } from 'lucide-react'
import { SubmitButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthFormField } from '@/components/auth/auth-form-field'
import { changeCredentialEmailAction } from '@/actions/profile'
import { ProfileFormDialog } from './profile-form-dialog'

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
    return (e: React.FormEvent<HTMLFormElement>) => {
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
        const result = await changeCredentialEmailAction(null, data)
        if (result.status === 'ok') {
          toast.warning('Sign-in email updated. Use your new email to sign in next time.')
          closeDialog()
          router.refresh()
        } else {
          toast.error(result.message ?? 'Failed to update email.')
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
      triggerIcon={<Pencil className="mr-1 size-3" />}
      triggerClassName="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
      onOpenChange={handleOpenChange}
    >
      {({ closeDialog }) => (
        <>
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2.5 text-sm text-yellow-600 dark:text-yellow-400">
            After saving, use your <strong>new email</strong> to sign in next time.
          </div>

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
