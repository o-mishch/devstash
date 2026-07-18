import type { ReactNode } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { BarChart3, FileText, FolderOpen, KeyRound, Package, UserRound } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useSession } from '@/auth/session'
import { useStats } from '@/hooks/use-stats'
import { itemTypeMeta } from '@/lib/item-types'
import { cn, hasText } from '@/lib/utils'
import { PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { EditableName } from '@/components/profile/editable-name'
import { DeleteAccountDialog } from '@/components/profile/delete-account-dialog'

export const Route = createFileRoute('/_app/profile')({
  component: Profile,
})

function Profile(): ReactNode {
  const { data: session } = useSession()
  const stats = useStats()
  const user = session?.user

  const displayName = hasText(user?.name) ? user.name : (user?.email ?? '')
  const initials = displayName.trim().slice(0, 2).toUpperCase()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader icon={UserRound} title="Profile" description="Account security and usage." />

      <Section icon={UserRound} title="Account Information">
        <div className="flex items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-lg font-medium text-primary">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            {user ? <EditableName name={user.name} /> : <Skeleton className="h-5 w-32" />}
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{user?.email}</p>
          </div>
          <Badge variant={user?.isPro === true ? 'default' : 'secondary'}>
            {user?.isPro === true ? 'Pro' : 'Free'}
          </Badge>
        </div>
      </Section>

      <Section icon={KeyRound} title="Sign-in Methods">
        <p className="text-sm text-muted-foreground">
          Email changes and connected-account management are handled on the{' '}
          <a
            href="https://devstash.one/profile"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            main app
          </a>{' '}
          for now.
        </p>
      </Section>

      <Section icon={BarChart3} title="Usage">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UsageTile icon={Package} label="Items" value={stats.data?.totalItems} />
            <UsageTile icon={FolderOpen} label="Collections" value={stats.data?.totalCollections} />
          </div>

          <Separator />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(stats.data?.itemTypeCounts ?? []).map((type) => {
              const meta = itemTypeMeta(type.name)
              const Icon = meta?.icon ?? FileText
              return (
                <div
                  key={type.name}
                  className="flex items-center justify-between rounded-lg border border-border px-2.5 py-2"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Icon className={cn('size-3.5 shrink-0', meta?.accent)} />
                    <span className="truncate text-xs">{meta?.label ?? type.name}</span>
                  </div>
                  <span className="ml-1.5 shrink-0 text-xs font-semibold text-muted-foreground">
                    {type.count}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Delete Account</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Permanently removes your account and all data. This cannot be undone.
            </p>
          </div>
          <DeleteAccountDialog />
        </div>
      </div>
    </div>
  )
}

interface SectionProps {
  icon: LucideIcon
  title: string
  children: ReactNode
}

/** A titled card section on the profile page (icon + heading + content). */
function Section({ icon: Icon, title, children }: SectionProps): ReactNode {
  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </section>
  )
}

interface UsageTileProps {
  icon: LucideIcon
  label: string
  value: number | undefined
}

function UsageTile({ icon: Icon, label, value }: UsageTileProps): ReactNode {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <Icon className="size-5 text-muted-foreground" />
      <div>
        {typeof value === 'number' ? (
          <p className="text-xl font-semibold">{value}</p>
        ) : (
          <Skeleton className="h-6 w-8" />
        )}
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  )
}
