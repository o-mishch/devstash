import { markEmailVerifiedByEmail } from '@/lib/db/users'
import { consumeVerificationToken } from '@/lib/auth/tokens'
import { AuthStatusPage, MissingTokenPage } from '@/components/auth/auth-page-header'

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string }>
}

// Static across every render of this Server Component — hoisted so the `action` prop is a stable
// reference instead of a new object literal per request (both success and error states use it).
const SIGN_IN_ACTION = { label: 'Sign in', href: '/sign-in' }

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams

  if (!token) {
    return <MissingTokenPage noun="verification token" />
  }

  // Redis-backed single-use token: GETDEL returns the payload and deletes it atomically. An absent
  // key (expired via TTL, already used, or never valid) yields null — collapsed into one error
  // state. The resend affordance lives on the sign-in flow (unverified login offers a resend).
  const consumed = await consumeVerificationToken(token)

  if (!consumed) {
    return (
      <AuthStatusPage
        variant="error"
        title="Link invalid or expired"
        description="This verification link is invalid, has expired, or was already used. Sign in to request a new one."
        action={SIGN_IN_ACTION}
      />
    )
  }

  await markEmailVerifiedByEmail(consumed.email)

  return (
    <AuthStatusPage
      variant="success"
      title="Email verified"
      description="Your email address has been confirmed. You can now sign in to your account."
      action={SIGN_IN_ACTION}
    />
  )
}
