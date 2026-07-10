import { TokenGatedPage } from '@/components/auth/token-gated-page'
import { peekPasswordResetToken } from '@/lib/auth/tokens'
import { TokenPasswordForm } from '@/components/auth/dynamic-forms'

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>
}

// Static, no dependency on props/state — hoisted so it isn't recreated on every render.
const INVALID_TOKEN_ACTION = { label: 'Request new link', href: '/forgot-password' }

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token } = await searchParams

  return (
    <TokenGatedPage
      token={token}
      peek={peekPasswordResetToken}
      invalidDescription="This password reset link is invalid, has expired, or was already used."
      invalidAction={INVALID_TOKEN_ACTION}
      title="Reset password"
      description="Enter your new password below."
    >
      {(t) => (
        <TokenPasswordForm
          token={t}
          path="/auth/reset-password"
          successMessage="Password updated! You can now sign in."
          passwordLabel="New password"
          submitLabel="Reset password"
        />
      )}
    </TokenGatedPage>
  )
}
