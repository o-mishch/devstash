import { AuthFormLayout, AuthStatusPage } from '@/components/auth/auth-page-header'
import { GitHubIcon } from '@/components/icons/github'
import { getPendingLink } from '@/lib/pending-link'
import { linkAccountAction } from '@/actions/auth'
import { LinkAccountForm } from './_components/link-account-form'

interface LinkAccountPageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function LinkAccountPage({ searchParams }: LinkAccountPageProps) {
  const { token } = await searchParams

  if (!token) {
    return (
      <AuthStatusPage
        variant="error"
        title="Missing token"
        description="No account link token was provided."
      />
    )
  }

  const pending = await getPendingLink(token)

  if (!pending) {
    return (
      <AuthStatusPage
        variant="error"
        title="Link expired"
        description="This account linking session has expired or was already used. Please try signing in with GitHub again."
        action={{ label: 'Back to sign in', href: '/sign-in' }}
      />
    )
  }

  const boundAction = linkAccountAction.bind(null, token)

  return (
    <AuthFormLayout
      title="Link your GitHub account"
      description={
        <span>
          A DevStash account already exists for{' '}
          <strong className="text-foreground">{pending.email}</strong>. Enter your password to link
          your GitHub account to it.
        </span>
      }
    >
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        <GitHubIcon className="size-4 shrink-0" />
        <span>Signing in via GitHub</span>
      </div>
      <LinkAccountForm action={boundAction} />
    </AuthFormLayout>
  )
}
