import { AuthFormLayout, MissingTokenPage, ExpiredTokenPage } from '@/components/auth/auth-page-header'
import githubSvg from '@/assets/icons/github.svg'
import { SvgIcon } from '@/components/icons/svg-icon'
import { getPendingLink } from '@/lib/pending-link'
import { linkAccountAction } from '@/actions/auth/link'
import { LinkAccountForm } from './_components/link-account-form'

interface LinkAccountPageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function LinkAccountPage({ searchParams }: LinkAccountPageProps) {
  const { token } = await searchParams

  if (!token) {
    return <MissingTokenPage noun="account link token" />
  }

  const pending = await getPendingLink(token)

  if (!pending) {
    return (
      <ExpiredTokenPage
        noun="account linking session"
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
        <SvgIcon src={githubSvg} className="size-4 shrink-0" />
        <span>Signing in via GitHub</span>
      </div>
      <LinkAccountForm action={boundAction} />
    </AuthFormLayout>
  )
}
