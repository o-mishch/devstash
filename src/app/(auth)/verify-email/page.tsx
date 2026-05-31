import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { getVerificationToken, deleteVerificationToken, verifyUserEmailAndToken } from '@/lib/db/users'
import { resendVerification } from '@/lib/emails/verification'
import { AuthStatusPage, MissingTokenPage, ExpiredTokenPage } from '@/components/auth/auth-page-header'

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams

  if (!token) {
    return <MissingTokenPage noun="verification token" />
  }

  const record = await getVerificationToken(token)

  if (!record || record.identifier.startsWith('password-reset:')) {
    return (
      <ErrorCard
        title="Link invalid"
        description="This verification link is invalid or has already been used."
      />
    )
  }

  if (record.expires < new Date()) {
    await deleteVerificationToken(token)
    return (
      <ExpiredTokenPage
        noun="verification link"
        footer={<ResendButton email={record.identifier} />}
      />
    )
  }

  await verifyUserEmailAndToken(record.identifier, token)

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

interface ResendButtonProps {
  email: string
}

function ResendButton({ email }: ResendButtonProps) {
  async function resend() {
    'use server'
    await resendVerification(email)
    redirect('/sign-in?resent=1')
  }

  return (
    <form action={resend}>
      <button type="submit" className="text-sm text-primary underline-offset-4 hover:underline">
        Resend verification email
      </button>
    </form>
  )
}
