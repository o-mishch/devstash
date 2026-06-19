'use client'

import dynamic from 'next/dynamic'

// Auth forms use `ssr: false` to avoid hydration mismatches from browser extensions
// (e.g. password managers, icon injectors) that modify input DOM before React hydrates.
// Each form provides a `loading` skeleton sized to match the real form so the card
// doesn't collapse and re-expand while the client bundle loads.

function SignInSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      <div className="flex flex-col gap-1.5">
        <div className="h-4 w-10 rounded bg-muted" />
        <div className="h-8 rounded-lg bg-muted" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <div className="h-4 w-16 rounded bg-muted" />
          <div className="h-3 w-24 rounded bg-muted" />
        </div>
        <div className="h-8 rounded-lg bg-muted" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="h-8 rounded-lg bg-muted" />
        <div className="h-8 rounded-lg bg-muted" />
      </div>
      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <div className="h-3 w-4 rounded bg-muted" />
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="h-8 rounded-lg bg-muted" />
        <div className="h-8 rounded-lg bg-muted" />
      </div>
    </div>
  )
}

function FieldSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex flex-col gap-1.5">
        <div className="h-4 w-10 rounded bg-muted" />
        <div className="h-8 rounded-lg bg-muted" />
      </div>
      <div className="h-8 rounded-lg bg-muted" />
    </div>
  )
}

export const SignInForm = dynamic(
  () => import('@/components/auth/sign-in-form').then((m) => ({ default: m.SignInForm })),
  { ssr: false, loading: SignInSkeleton },
)

export const RegisterForm = dynamic(
  () => import('@/components/auth/register-form').then((m) => ({ default: m.RegisterForm })),
  { ssr: false, loading: FieldSkeleton },
)

export const ForgotPasswordForm = dynamic(
  () => import('@/components/auth/forgot-password-form').then((m) => ({ default: m.ForgotPasswordForm })),
  { ssr: false, loading: FieldSkeleton },
)

export const TokenPasswordForm = dynamic(
  () => import('@/components/auth/token-password-form').then((m) => ({ default: m.TokenPasswordForm })),
  { ssr: false, loading: FieldSkeleton },
)

export const LinkAccountForm = dynamic(
  () => import('@/components/auth/link-account-form').then((m) => ({ default: m.LinkAccountForm })),
  { ssr: false, loading: FieldSkeleton },
)
