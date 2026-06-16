import type { ReactNode } from 'react'
import { getVerificationToken, deleteVerificationToken, verifyUserEmailAndToken } from '@/lib/db/users'
import { hashToken } from '@/lib/auth/tokens'
import { AuthStatusPage, MissingTokenPage, ExpiredTokenPage } from '@/components/auth/auth-page-header'
import { ResendVerificationButton } from '@/components/auth/resend-verification-button'

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams

  if (!token) {
    return <MissingTokenPage noun="verification token" />
  }

  // Tokens are stored hashed at rest (Case 8); the URL carries the raw token, so hash it to look up.
  const hashed = hashToken(token)
  const record = await getVerificationToken(hashed)

  if (!record || record.identifier.startsWith('password-reset:')) {
    return (
      <ErrorCard
        title="Link invalid"
        description="This verification link is invalid or has already been used."
      />
    )
  }

  if (record.expires < new Date()) {
    await deleteVerificationToken(hashed)
    return (
      <ExpiredTokenPage
        noun="verification link"
        footer={<ResendVerificationButton email={record.identifier} />}
      />
    )
  }

  await verifyUserEmailAndToken(record.identifier, hashed)

  return (
    <AuthStatusPage
      variant="success"
      title="Email verified"
      description="Your email address has been confirmed. You can now sign in to your account."
      action={{ label: 'Sign in', href: '/sign-in' }}
    />
  )
}

interface ErrorCardProps {
  title: string
  description: string
  footer?: ReactNode
}

function ErrorCard({ title, description, footer }: ErrorCardProps) {
  return (
    <AuthStatusPage
      variant="error"
      title={title}
      description={description}
      footer={footer}
    />
  )
}

