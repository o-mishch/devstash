import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getCurrentUserId } from '@/lib/session'
import { EditorPreferencesForm } from './_components/editor-preferences-form'

export default async function SettingsPage() {
  const userId = await getCurrentUserId()
  if (!userId) redirect('/sign-in')

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
          <p className="text-sm text-muted-foreground">Manage your editor and application preferences</p>
        </div>
      </div>

      <EditorPreferencesForm />
    </div>
  )
}
