import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Settings as SettingsIcon } from 'lucide-react'
import { PageHeader } from '@/components/app/page-header'
import { BillingSettings } from '@/components/settings/billing-settings'
import { DashboardSkinPicker } from '@/components/settings/dashboard-skin-picker'
import { AppThemePicker } from '@/components/settings/app-theme-picker'
import { EditorSettings } from '@/components/settings/editor-settings'

export const Route = createFileRoute('/_app/settings')({
  component: Settings,
})

function Settings(): ReactNode {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={SettingsIcon}
        title="Settings"
        description="Manage your editor and application preferences."
      />
      <BillingSettings />
      <DashboardSkinPicker />
      <AppThemePicker />
      <EditorSettings />
    </div>
  )
}
