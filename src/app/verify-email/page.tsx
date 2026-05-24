import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Archive } from 'lucide-react'
import { prisma } from '@/lib/prisma'
import { resendVerification } from '@/lib/emails/verification'

interface VerifyEmailPageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const { token } = await searchParams

  if (!token) {
    return <ErrorView message="Missing verification token." />
  }

  const record = await prisma.verificationToken.findUnique({
    where: { token },
  })

  if (!record) {
    return <ErrorView message="Invalid or already used verification link." />
  }

  if (record.expires < new Date()) {
    await prisma.verificationToken.delete({ where: { token } })
    return (
      <ErrorView
        message="This link has expired. Please request a new one."
        showResend
        email={record.identifier}
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

  redirect('/sign-in?verified=1')
}

interface ErrorViewProps {
  message: string
  showResend?: boolean
  email?: string
}

function ErrorView({ message, showResend, email }: ErrorViewProps) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex items-center justify-center gap-2">
          <Archive className="size-5 text-primary" />
          <span className="text-xl font-semibold tracking-tight">DevStash</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl font-bold">Verification failed</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        <div className="flex flex-col gap-2">
          {showResend && email && <ResendButton email={email} />}
          <Link
            href="/sign-in"
            className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
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
