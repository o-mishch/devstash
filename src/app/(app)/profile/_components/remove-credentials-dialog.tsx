
import { Unlink } from 'lucide-react'
import { removeCredentialsAction } from '@/actions/profile'
import { ProfileActionDialog } from './profile-action-dialog'

export function RemoveCredentialsDialog() {
  return (
    <ProfileActionDialog
      title="Remove password"
      description="Your email & password sign-in will be removed. You can still sign in via your linked accounts."
      triggerText="Unlink"
      triggerIcon={<Unlink className="mr-1 size-3" />}
      confirmText="Remove password"
      action={removeCredentialsAction}
      successMessage="Password removed. Sign in via a linked account."
      errorMessage="Failed to remove password."
    />
  )
}
