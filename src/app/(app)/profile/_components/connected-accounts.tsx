import type { ComponentType } from 'react'
import { Mail, Globe } from 'lucide-react'
import githubSvg from '@/assets/icons/github.svg'
import { SvgIcon } from '@/components/icons/svg-icon'
import { PROVIDER_LABELS } from '@/lib/utils'
import type { LinkedAccount } from '@/lib/db/profile'
import { UnlinkProviderDialog } from './unlink-provider-dialog'

interface ConnectedAccountsProps {
  hasPassword: boolean
  accounts: LinkedAccount[]
}

interface ProviderMeta {
  Icon: ComponentType<{ className?: string }>
}

interface ProviderIconProps {
  className?: string
}

function GitHubProviderIcon({ className }: ProviderIconProps) {
  return <SvgIcon src={githubSvg} className={className} />
}

const PROVIDER_META: Record<string, ProviderMeta> = {
  github: { Icon: GitHubProviderIcon },
}

function EmailRow() {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-2.5 text-sm">
        <Mail className="size-4 shrink-0 text-muted-foreground" />
        <span>Email &amp; Password</span>
      </div>
      <span className="text-xs text-muted-foreground">Connected</span>
    </div>
  )
}

interface ProviderAccountRowProps {
  account: LinkedAccount
  canUnlink: boolean
}

function ProviderAccountRow({ account, canUnlink }: ProviderAccountRowProps) {
  const meta = PROVIDER_META[account.provider]
  const label = PROVIDER_LABELS[account.provider] ?? account.provider
  const Icon = meta?.Icon ?? Globe

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="flex items-center gap-2.5 text-sm">
        <span className="text-muted-foreground"><Icon className="size-4 shrink-0" /></span>
        <span>{label}</span>
      </div>
      {canUnlink ? (
        <UnlinkProviderDialog accountId={account.id} label={label} />
      ) : (
        <span className="text-xs text-muted-foreground">Connected</span>
      )}
    </div>
  )
}

export function ConnectedAccounts({ hasPassword, accounts }: ConnectedAccountsProps) {
  const totalMethods = (hasPassword ? 1 : 0) + accounts.length

  return (
    <div className="space-y-2">
      {hasPassword && <EmailRow />}
      {accounts.map((account) => (
        <ProviderAccountRow
          key={account.id}
          account={account}
          canUnlink={totalMethods > 1}
        />
      ))}
    </div>
  )
}
