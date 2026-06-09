import Link from 'next/link'
import { CircleCheck } from 'lucide-react'
import { AuthFormLayout, AuthPageBase } from '@/components/auth/auth-page-header'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'

interface ForgotPasswordPageProps {
  searchParams: Promise<{ sent?: string; email?: string }>
}

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const { sent, email } = await searchParams

  if (sent === '1') {
    return (
      <AuthPageBase>
        <Card>
          <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
            <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10">
              <CircleCheck className="size-7 text-emerald-500" />
            </div>

            <div className="space-y-3">
              <p className="text-lg font-semibold">Check your email</p>
              <div className="space-y-1.5 text-sm text-muted-foreground">
                <p>
                  {email ? (
                    <>
                      If <span className="font-medium text-foreground">{email}</span> is registered,
                      we&apos;ve sent a password reset link to that address.
                    </>
                  ) : (
                    <>If that email is registered, we&apos;ve sent a password reset link.</>
                  )}
                </p>
                <p>The link will expire in 1 hour.</p>
                <p>Didn&apos;t receive the email? Check your spam folder or try again.</p>
              </div>
            </div>

            <div className="grid w-full grid-cols-2 gap-2">
              <Link href="/forgot-password" className={buttonVariants({ variant: 'outline' })}>
                Try a different email
              </Link>
              <Link href="/sign-in" className={buttonVariants({ variant: 'outline' })}>
                Back to sign in
              </Link>
            </div>
          </CardContent>
        </Card>
      </AuthPageBase>
    )
  }

  return (
    <AuthFormLayout
      title="Forgot your password?"
      description="Enter your email and we'll send you a link to reset your password."
    >
      <ForgotPasswordForm />
    </AuthFormLayout>
  )
}
