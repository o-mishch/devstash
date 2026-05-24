import { Archive } from 'lucide-react'
import { SignInForm } from './_components/sign-in-form'

export default function SignInPage() {
  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-2">
          <Archive className="size-5 text-primary" />
          <span className="text-xl font-semibold tracking-tight">DevStash</span>
        </div>
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="text-sm text-muted-foreground">
          Welcome back. Sign in to your account.
        </p>
      </div>

      <SignInForm />
    </div>
  )
}
