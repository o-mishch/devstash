import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { resendVerification } from '@/lib/emails/verification'
import { AuthLogo } from '@/components/auth/auth-logo'
import { StatusCard } from '@/components/auth/status-card'

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams

  if (!token) {
    return <ErrorCard title="Missing token" description="No verification token was provided." />
  }

  const record = await prisma.verificationToken.findUnique({ where: { token } })

  if (!record) {
    return (
      <ErrorCard
        title="Link invalid"
        description="This verification link is invalid or has already been used."
      />
    )
  }

  if (record.expires < new Date()) {
    await prisma.verificationToken.delete({ where: { token } })
    return (
      <ErrorCard
        title="Link expired"
        description="This verification link has expired."
        footer={<ResendButton email={record.identifier} />}
      />
    )
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { email: record.identifier },
      data: { emailVerified: new Date() },
    }),
    prisma.verificationToken.delete({ where: { token } }),
  ])

  return (
    <VerifyLayout>
      <StatusCard
        variant="success"
        title="Email verified"
        description="Your email address has been confirmed. You can now sign in to your account."
        action={{ label: 'Sign in', href: '/sign-in' }}
      />
    </VerifyLayout>
  )
}

interface ErrorCardProps {
  title: string
  description: string
  footer?: React.ReactNode
}

function ErrorCard({ title, description, footer }: ErrorCardProps) {
  return (
    <VerifyLayout>
      <StatusCard
        variant="error"
        title={title}
        description={description}
        action={{ label: 'Back to sign in', href: '/sign-in' }}
        footer={footer}
      />
    </VerifyLayout>
  )
}

function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex justify-center">
        <AuthLogo />
      </div>
      {children}
    </div>
  )
}

function ResendButton({ email }: { email: string }) {
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
