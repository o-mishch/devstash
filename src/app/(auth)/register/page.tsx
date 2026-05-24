import Link from 'next/link'
import { Archive } from 'lucide-react'
import { RegisterForm } from './_components/register-form'

export default function RegisterPage() {
  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-2">
          <Archive className="size-5 text-primary" />
          <span className="text-xl font-semibold tracking-tight">DevStash</span>
        </div>
        <h1 className="text-2xl font-bold">Create an account</h1>
        <p className="text-sm text-muted-foreground">
          Get started with your developer knowledge hub.
        </p>
      </div>

      <RegisterForm />

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link
          href="/sign-in"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  )
}
