import { SignInForm } from './_components/sign-in-form'
import { AuthLogo } from '@/components/auth/auth-logo'

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
    <div className="w-full max-w-sm space-y-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <AuthLogo />
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Welcome back. Sign in to your account.
        </p>
      </div>

      <SignInForm successMessage={getSuccessMessage(verified, resent)} />
    </div>
  )
}
