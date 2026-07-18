import type { ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { XCircle } from 'lucide-react'
import { authOauthLinkMutation } from '@/client/@tanstack/react-query.gen'
import { useAuthenticatedRedirect } from '@/auth/actions'
import { redirectSearchSchema } from '@/auth/redirect'
import { tokenSearchSchema } from '@/auth/search'
import { linkAccountSchema } from '@/auth/schemas'
import { submitting, useAppForm } from '@/components/form/form-hook'
import { hasText } from '@/lib/utils'
import { AUTH_LINK_CLASS, AuthForm, AuthShell } from '@/components/auth/auth-shell'

/**
 * `token` is the ONLY param the OAuth callback sets on this redirect. The page previously
 * also read `email` and `provider` and rendered them as prose above the password field —
 * but nothing server-side ever set them, so the only way to populate them was a
 * hand-crafted URL. That made this a text-injection surface on a credential-entry page
 * served from our own origin under our own certificate: React escapes the value, so it
 * was never XSS, but attacker-authored copy inside the trusted card above a password box
 * with a real padlock is the whole payload a phishing page needs. The identity behind the
 * token lives server-side; if this page ever needs to name it, the API must answer for it.
 */
export const Route = createFileRoute('/(auth)/link-account')({
  // `token` is set by the OAuth callback; `redirect` is the sanitized deep-link target it
  // carries through so a conflicted sign-in still lands where it started after the confirm.
  validateSearch: tokenSearchSchema.extend(redirectSearchSchema.shape),
  component: LinkAccount,
})

function LinkAccount(): ReactNode {
  const { token, redirect: redirectTo } = Route.useSearch()
  const goAuthenticated = useAuthenticatedRedirect()

  const link = useMutation({
    ...authOauthLinkMutation(),
    onSuccess: async () => {
      // `redirectTo` may be undefined; `sanitizeRelative` at the sink maps that to the
      // single `/dashboard` fallback, so the default landing path lives in one place.
      await goAuthenticated(
        redirectTo,
        'Account linked, but loading your session failed. Please refresh the page.',
      )
    },
  })

  const form = useAppForm({
    defaultValues: { password: '' },
    validators: { onChange: linkAccountSchema },
    onSubmit: async ({ value }) => {
      if (!hasText(token)) return
      await submitting(link.mutateAsync({ body: { token, password: value.password } }))
    },
  })

  if (!hasText(token)) {
    return (
      <AuthShell
        title="Nothing to link"
        subtitle="This link request is missing or has expired. Try signing in again."
        icon={XCircle}
        iconVariant="error"
        footer={
          <Link to="/sign-in" className={AUTH_LINK_CLASS}>
            Back to sign in
          </Link>
        }
      />
    )
  }

  return (
    <AuthShell
      title="Link your account"
      subtitle="An account already exists for this email. Enter your password to connect your new sign-in method."
      footer={
        <Link to="/sign-in" className={AUTH_LINK_CLASS}>
          Cancel
        </Link>
      }
    >
      <AuthForm form={form} mutation={link}>
        <form.AppField name="password">
          {(field) => (
            <field.PasswordField
              label="Password"
              autoComplete="current-password"
              placeholder="Your existing password"
            />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Link account" />
        </form.AppForm>
      </AuthForm>
    </AuthShell>
  )
}
