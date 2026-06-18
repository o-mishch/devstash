'use client'

import dynamic from 'next/dynamic'

export const SignInForm = dynamic(
  () => import('@/components/auth/sign-in-form').then((m) => ({ default: m.SignInForm })),
  { ssr: false },
)

export const RegisterForm = dynamic(
  () => import('@/components/auth/register-form').then((m) => ({ default: m.RegisterForm })),
  { ssr: false },
)

export const ForgotPasswordForm = dynamic(
  () => import('@/components/auth/forgot-password-form').then((m) => ({ default: m.ForgotPasswordForm })),
  { ssr: false },
)

export const TokenPasswordForm = dynamic(
  () => import('@/components/auth/token-password-form').then((m) => ({ default: m.TokenPasswordForm })),
  { ssr: false },
)

export const LinkAccountForm = dynamic(
  () => import('@/components/auth/link-account-form').then((m) => ({ default: m.LinkAccountForm })),
  { ssr: false },
)
