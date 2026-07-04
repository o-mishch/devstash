import { AuthFormLayout, MissingTokenPage, ExpiredTokenPage } from '@/components/auth/auth-page-header'
import githubSvg from '@/assets/icons/github.svg'
import googleSvg from '@/assets/icons/google.svg'
import { SvgIcon } from '@/components/icons/svg-icon'
import { getPendingLink } from '@/lib/auth/pending-link'
import { linkAccountAction, autoLinkAccountAction } from '@/actions/auth/link'
import { signInWithOAuthForLinkAction } from '@/actions/auth/login'
import { auth } from '@/auth'
import { PROVIDER_LABELS } from '@/lib/utils'
import { SubmitButton, buttonVariants } from '@/components/ui/button'
import { LinkAccountForm } from '@/components/auth/dynamic-forms'
import { getUserAuthInfoByEmail, getUserAuthMethods } from '@/lib/db/users'
import type { OAuthProvider } from '@/lib/utils/constants'
import Link from 'next/link'

interface LinkAccountPageProps {
  searchParams: Promise<{ token?: string }>
}

const PROVIDER_ICONS: Record<string, { src: string; alt: string }> = {
  github: { src: githubSvg, alt: 'GitHub' },
  google: { src: googleSvg, alt: 'Google' },
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

  const providerLabel = PROVIDER_LABELS[pending.provider] ?? pending.provider
  const providerIcon = PROVIDER_ICONS[pending.provider]
  const session = await auth()
  const isAlreadySignedIn = session?.user?.email === pending.email

  // Auto-link flow: user is already authenticated — skip password, just confirm
  if (isAlreadySignedIn) {
    const boundAction = autoLinkAccountAction.bind(null, token)

    return (
      <AuthFormLayout
        title={`Link your ${providerLabel} account`}
        description={
          <span>
            Link your <strong className="text-foreground">{providerLabel}</strong> account to your
            DevStash account.
          </span>
        }
      >
        {providerIcon && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <SvgIcon src={providerIcon.src} className="size-4 shrink-0" />
            <div className="min-w-0">
              <span>Signing in via {providerLabel}</span>
              {pending.providerEmail && (
                <p className="truncate text-xs">{pending.providerEmail}</p>
              )}
            </div>
          </div>
        )}
        <form action={boundAction}>
          <SubmitButton className="w-full" isPending={false}>
            Link {providerLabel} account
          </SubmitButton>
        </form>
      </AuthFormLayout>
    )
  }

  const existingUser = await getUserAuthInfoByEmail(pending.email)
  const hasPassword = !!existingUser?.password

  if (existingUser && !hasPassword) {
    const authMethods = await getUserAuthMethods(existingUser.id)
    const existingAccounts = authMethods?.accounts ?? []

    return (
      <AuthFormLayout
        title="Sign in to continue"
        description={
          <span>
            An account for <strong className="text-foreground">{pending.email}</strong> already exists.
            Sign in below to link your <strong className="text-foreground">{providerLabel}</strong> account to it.
          </span>
        }
      >
        <div className="flex flex-col gap-2">
          {existingAccounts.map((account) => {
            const existingProvider = account.provider as OAuthProvider
            const existingProviderLabel = PROVIDER_LABELS[existingProvider] ?? existingProvider
            const icon = PROVIDER_ICONS[existingProvider]
            const boundAction = signInWithOAuthForLinkAction.bind(null, existingProvider, token)
            return (
              <form key={existingProvider} action={boundAction}>
                <SubmitButton variant="outline" className="w-full" isPending={false}>
                  {icon && <SvgIcon src={icon.src} className="size-4 shrink-0" />}
                  Sign in with {existingProviderLabel}
                </SubmitButton>
              </form>
            )
          })}
          {existingAccounts.length === 0 && (
            <Link href="/sign-in" className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
              Return to sign in
            </Link>
          )}
        </div>
      </AuthFormLayout>
    )
  }

  // Password flow: user is not signed in — verify credentials before linking
  const boundAction = linkAccountAction.bind(null, token)

  return (
    <AuthFormLayout
      title={`Link your ${providerLabel} account`}
      description={
        <span>
          A DevStash account already exists for{' '}
          <strong className="text-foreground">{pending.email}</strong>. Enter your password to link
          your {providerLabel} account to it.
        </span>
      }
    >
      {providerIcon && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <SvgIcon src={providerIcon.src} className="size-4 shrink-0" />
          <span>Signing in via {providerLabel}</span>
        </div>
      )}
      <LinkAccountForm action={boundAction} providerLabel={providerLabel} />
    </AuthFormLayout>
  )
}
