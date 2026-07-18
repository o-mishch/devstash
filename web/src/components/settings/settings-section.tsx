import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

interface SettingsSectionProps {
  icon: LucideIcon
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}

/** A titled card section on the settings page (icon + heading + optional subtitle + content). */
export function SettingsSection({
  icon: Icon,
  title,
  subtitle,
  actions,
  children,
}: SettingsSectionProps): ReactNode {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 size-4 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-semibold">{title}</h2>
            {subtitle !== undefined && (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}
