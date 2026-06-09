import { AuthFormLayout, AuthStatusPage, MissingTokenPage, ExpiredTokenPage } from '@/components/auth/auth-page-header'
import { peekPasswordResetToken } from '@/lib/auth/tokens'
import { resetPasswordAction } from '@/actions/auth/reset'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token } = await searchParams

  if (!token) {
    return <MissingTokenPage />
  }

  const status = await peekPasswordResetToken(token)

  if (status === 'expired') {
    return (
      <ExpiredTokenPage
        noun="password reset link"
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
