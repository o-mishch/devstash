
import { Unlink } from 'lucide-react'
import { unlinkProviderAction } from '@/actions/profile'
import { ProfileActionDialog } from './profile-action-dialog'

interface UnlinkProviderDialogProps {
  accountId: string
  label: string
}

export function UnlinkProviderDialog({ accountId, label }: UnlinkProviderDialogProps) {
  return (
    <ProfileActionDialog
      title={`Unlink ${label}`}
      description={`Your ${label} account will be disconnected. You can still sign in with your other linked methods.`}
      triggerText="Unlink"
      triggerIcon={<Unlink className="mr-1 size-3" />}
      confirmText={`Unlink ${label}`}
      action={unlinkProviderAction.bind(null, accountId)}
      successMessage={`${label} account unlinked.`}
      errorMessage="Failed to unlink account."
    />
  )
}
