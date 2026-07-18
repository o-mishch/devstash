import { useState } from 'react'
import type { ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { authLoginMutation } from '@/client/@tanstack/react-query.gen'
import { authEntryRoute } from '@/auth/session'
import { redirectSearchSchema } from '@/auth/redirect'
import { optionalSearchString } from '@/auth/search'
import { signInSchema } from '@/auth/schemas'
import { useAuthenticatedRedirect } from '@/auth/actions'
import { apiErrorStatus } from '@/lib/api/errors'
import { submitting, useAppForm } from '@/components/form/form-hook'
import { hasText } from '@/lib/utils'
import { AUTH_LINK_CLASS, AuthAlert, AuthForm, AuthShell } from '@/components/auth/auth-shell'
import { OAuthButtons, AuthDivider } from '@/components/auth/oauth-buttons'

/**
 * The OAuth callback 302s here with `?error=<code>` on every failure path. Rendering is
 * allowlist-keyed and never echoes the param: it is attacker-controlled, and this page
 * collects a password — arbitrary text rendered above that field is a phishing surface,
 * not a diagnostic.
 */
const OAUTH_ERRORS: Record<string, string> = {
  oauth_denied: 'Sign-in was cancelled at the provider.',
  oauth_state: 'That sign-in link expired. Please try again.',
  oauth_exchange: "We couldn't complete sign-in with that provider. Please try again.",
  oauth_no_email:
    'That provider account has no usable email address. Sign in with email and password instead.',
  oauth_server: 'Something went wrong on our side. Please try again.',
}

export const Route = createFileRoute('/(auth)/sign-in')({
  ...authEntryRoute,
  // Extends (never replaces) the entry schema, so `redirect` stays sanitized by the same
  // transform the guard in `authEntryRoute.beforeLoad` depends on.
  validateSearch: redirectSearchSchema.extend({ error: optionalSearchString }),
  component: SignIn,
})

function SignIn(): ReactNode {
  const { redirect: redirectTo, error: oauthError } = Route.useSearch()
  const goAuthenticated = useAuthenticatedRedirect()
  // The email as SUBMITTED, captured at submit time rather than read off the form when the
  // link renders. `form.getFieldValue` is a plain store read with no subscription, so this
  // component would not re-render on later edits: the 403 persists until the next submit, and
  // the link would keep pointing at the old address while the field shows a new one — silently
  // resending to somewhere the user is no longer looking, since the endpoint is
  // enumeration-safe and says "a new link is on its way" either way.
  const [submittedEmail, setSubmittedEmail] = useState('')

  const login = useMutation({
    ...authLoginMutation(),
    onSuccess: async () => {
      // `redirectTo` may be undefined; `sanitizeRelative` at the sink maps that to the
      // single `/dashboard` fallback, so the default landing path lives in one place.
      await goAuthenticated(
        redirectTo,
        'Signed in, but loading your session failed. Please refresh the page.',
      )
    },
  })

  const form = useAppForm({
    defaultValues: { email: '', password: '' },
    validators: { onChange: signInSchema },
    onSubmit: async ({ value }) => {
      setSubmittedEmail(value.email)
      await submitting(login.mutateAsync({ body: value }))
    },
  })

  // The API answers an unverified-but-correct credential with 403 and a message only —
  // it expects this page to route the user to the resend flow, since we hold the email.
  const needsVerification = apiErrorStatus(login.error) === 403

  return (
    <AuthShell
      title="Sign in"
      subtitle="Welcome back to your dev knowledge hub."
      footer={
        <>
          New here?{' '}
          <Link to="/register" search={{ redirect: redirectTo }} className={AUTH_LINK_CLASS}>
            Create an account
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {hasText(oauthError) && (
          <AuthAlert
            message={
              // `oauthError` is an untrusted URL param; index only own keys so
              // `?error=toString` (and other prototype keys) can't return a non-string.
              (Object.hasOwn(OAUTH_ERRORS, oauthError) ? OAUTH_ERRORS[oauthError] : undefined) ??
              'Sign-in failed. Please try again.'
            }
          />
        )}
        <AuthForm form={form} mutation={login}>
          {needsVerification && (
            <Link to="/verify-email" search={{ email: submittedEmail }} className={AUTH_LINK_CLASS}>
              Resend verification link
            </Link>
          )}
          <form.AppField name="email">{(field) => <field.EmailField />}</form.AppField>
          <form.AppField name="password">
            {(field) => (
              <field.PasswordField
                label="Password"
                autoComplete="current-password"
                placeholder="••••••••"
              />
            )}
          </form.AppField>
          <div className="flex justify-end">
            <Link
              to="/forgot-password"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Forgot password?
            </Link>
          </div>
          <form.AppForm>
            <form.SubmitButton label="Sign in" />
          </form.AppForm>
        </AuthForm>
        <AuthDivider />
        <OAuthButtons redirect={redirectTo} />
      </div>
    </AuthShell>
  )
}
