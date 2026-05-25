import { AuthFormLayout, AuthStatusPage } from '@/components/auth/auth-page-header'
import { peekPasswordResetToken } from '@/lib/tokens'
import { resetPasswordAction } from '@/actions/auth'
import { ResetPasswordForm } from './_components/reset-password-form'

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token } = await searchParams

  if (!token) {
    return (
      <AuthStatusPage
        variant="error"
        title="Missing token"
        description="No reset token was provided."
      />
    )
  }

  const status = await peekPasswordResetToken(token)

  if (status === 'expired') {
    return (
      <AuthStatusPage
        variant="error"
        title="Link expired"
        description="This password reset link has expired. Request a new one."
        action={{ label: 'Request new link', href: '/forgot-password' }}
      />
    )
  }

  if (status === 'invalid') {
    return (
      <AuthStatusPage
        variant="error"
        title="Link invalid"
        description="This password reset link is invalid or has already been used."
      />
    )
  }

  const boundAction = resetPasswordAction.bind(null, token)

  return (
    <AuthFormLayout title="Reset password" description="Enter your new password below.">
      <ResetPasswordForm action={boundAction} />
    </AuthFormLayout>
  )
}
