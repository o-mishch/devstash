import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { getCurrentUserId } from '@/lib/session'
import { getProfileData } from '@/lib/db/profile'
import { ChangePasswordForm } from '../profile/_components/change-password-form'
import { DeleteAccountDialog } from '../profile/_components/delete-account-dialog'
import { EditorPreferencesForm } from './_components/editor-preferences-form'

export default async function SettingsPage() {
  const userId = await getCurrentUserId()
  if (!userId) redirect('/sign-in')

  const data = await getProfileData(userId)
  if (!data) redirect('/sign-in')

  const { user } = data

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start gap-3">
        <Link
          href="/dashboard"
          className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your application preferences and account settings</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Account Actions</CardTitle>
          <CardDescription>
            Manage your password or delete your account. This action cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            {user.hasPassword && <ChangePasswordForm />}
            <DeleteAccountDialog />
          </div>
        </CardContent>
      </Card>
      
      <EditorPreferencesForm />
    </div>
  )
}
