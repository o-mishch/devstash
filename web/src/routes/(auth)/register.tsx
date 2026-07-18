import { useState } from 'react'
import type { ReactNode } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { MailCheck } from 'lucide-react'
import { authRegisterMutation } from '@/client/@tanstack/react-query.gen'
import { authEntryRoute } from '@/auth/session'
import { sanitizeRelative } from '@/auth/redirect'
import { registerSchema } from '@/auth/schemas'
import { submitting, useAppForm } from '@/components/form/form-hook'
import { hasText } from '@/lib/utils'
import { AUTH_LINK_CLASS, AuthForm, AuthShell } from '@/components/auth/auth-shell'
import { OAuthButtons, AuthDivider } from '@/components/auth/oauth-buttons'

export const Route = createFileRoute('/(auth)/register')({
  ...authEntryRoute,
  component: Register,
})

function Register(): ReactNode {
  const router = useRouter()
  const { redirect: redirectTo } = Route.useSearch()
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null)

  const register = useMutation({
    ...authRegisterMutation(),
    // The server owns where registration lands, because only it knows whether an email
    // was actually sent: with the outbound-email kill switch on, it auto-verifies the
    // account and answers `/sign-in`. Assuming "check your email" here would tell those
    // users to click a link that was never sent, for an account already active.
    onSuccess: async (data, variables) => {
      if (data.redirectTo.startsWith('/sign-in')) {
        // Re-sanitize AT the sink rather than trusting the search schema alone — mirrors
        // `useAuthenticatedRedirect` in auth/actions.ts. `sanitizeRelative` is idempotent, so
        // this is a no-op for an already-clean value from `redirectSearchSchema`.
        await router.navigate({
          to: '/sign-in',
          search: { redirect: sanitizeRelative(redirectTo) },
        })
        return
      }
      setSubmittedEmail(variables.body.email)
    },
  })

  const form = useAppForm({
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
    validators: { onChange: registerSchema },
    onSubmit: async ({ value }) => {
      await submitting(register.mutateAsync({ body: value }))
    },
  })

  if (hasText(submittedEmail)) {
    return (
      <AuthShell
        title="Check your email"
        subtitle={`We sent a verification link to ${submittedEmail}. Click it to activate your account.`}
        icon={MailCheck}
        iconVariant="info"
        footer={
          <div className="flex flex-col gap-1">
            <span>
              Didn&apos;t get it?{' '}
              <Link
                to="/verify-email"
                search={{ email: submittedEmail }}
                className={AUTH_LINK_CLASS}
              >
                Resend the link
              </Link>
            </span>
            <span>
              <Link
                to="/sign-in"
                search={{ redirect: sanitizeRelative(redirectTo) }}
                className={AUTH_LINK_CLASS}
              >
                Back to sign in
              </Link>
            </span>
          </div>
        }
      />
    )
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start stashing snippets, prompts, and commands."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/sign-in" search={{ redirect: redirectTo }} className={AUTH_LINK_CLASS}>
            Sign in
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <AuthForm form={form} mutation={register}>
          <form.AppField name="name">
            {(field) => (
              <field.TextField label="Name" autoComplete="name" placeholder="Ada Lovelace" />
            )}
          </form.AppField>
          <form.AppField name="email">{(field) => <field.EmailField />}</form.AppField>
          <form.AppField name="password">
            {(field) => (
              <field.PasswordField
                label="Password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
            )}
          </form.AppField>
          <form.AppField name="confirmPassword">
            {(field) => (
              <field.PasswordField label="Confirm password" autoComplete="new-password" />
            )}
          </form.AppField>
          <form.AppForm>
            <form.SubmitButton label="Create account" />
          </form.AppForm>
        </AuthForm>
        <AuthDivider />
        <OAuthButtons redirect={redirectTo} />
      </div>
    </AuthShell>
  )
}
