import { SignInForm } from './_components/sign-in-form'
import { AuthFormLayout } from '@/components/auth/auth-page-header'

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

  return (
    <AuthFormLayout title="Sign in" description="Welcome back. Sign in to your account.">
      <SignInForm successMessage={getSuccessMessage(verified, resent)} />
    </AuthFormLayout>
  )
}
