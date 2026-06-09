import { redirect } from 'next/navigation'
import { SignInForm } from '@/components/auth/sign-in-form'
import { AuthFormLayout } from '@/components/auth/auth-page-header'
import { getCachedSession } from '@/lib/session'

interface SignInPageProps {
  searchParams: Promise<{ verified?: string; resent?: string }>
}

function getSuccessMessage(verified?: string, resent?: string): string | undefined {
  if (verified === '1') return 'Email verified! You can now sign in.'
  if (resent === '1') return 'Verification email resent. Check your inbox.'
  return undefined
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { verified, resent } = await searchParams
  const session = await getCachedSession()
  if (session?.user?.id) redirect('/dashboard')

  return (
    <AuthFormLayout title="Sign in" description="Welcome back. Sign in to your account.">
      <SignInForm successMessage={getSuccessMessage(verified, resent)} />
    </AuthFormLayout>
  )
}
