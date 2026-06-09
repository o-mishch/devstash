import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthFormLayout } from '@/components/auth/auth-page-header'
import { getCachedSession } from '@/lib/session'
import { buttonVariants } from '@/components/ui/button'
import { RegisterForm } from '@/components/auth/register-form'

interface RegisterPageProps {
  searchParams: Promise<{ pending?: string; email?: string; sent?: string }>
}

export default async function RegisterPage({ searchParams }: RegisterPageProps) {
  const { pending, email, sent } = await searchParams
  const session = await getCachedSession()
  if (session?.user?.id) redirect('/dashboard')

  if (pending === '1') {
    return (
      <AuthFormLayout
        title="Create an account"
        description="Get started with your developer knowledge hub."
      >
        <div className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            {sent === '1' ? (
              <>
                We sent a verification link to{' '}
                <span className="font-medium text-foreground">{email}</span>.
                Click it to activate your account.
              </>
            ) : (
              <>
                Your account was created, but we couldn&apos;t send the verification email to{' '}
                <span className="font-medium text-foreground">{email}</span>.
                Sign in and request a new verification link.
              </>
            )}
          </p>
          <Link
            href="/sign-in"
            className={buttonVariants({ variant: 'outline', className: 'w-full' })}
          >
            Go to sign in
          </Link>
        </div>
      </AuthFormLayout>
    )
  }

  return (
    <AuthFormLayout
      title="Create an account"
      description="Get started with your developer knowledge hub."
    >
      <RegisterForm />
    </AuthFormLayout>
  )
}
