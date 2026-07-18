import { useState } from 'react'
import type { ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, XCircle } from 'lucide-react'
import { authResetPasswordMutation } from '@/client/@tanstack/react-query.gen'
import { tokenSearchSchema } from '@/auth/search'
import { resetPasswordSchema } from '@/auth/schemas'
import { submitting, useAppForm } from '@/components/form/form-hook'
import { hasText } from '@/lib/utils'
import { AUTH_LINK_CLASS, AuthForm, AuthShell } from '@/components/auth/auth-shell'

export const Route = createFileRoute('/(auth)/reset-password')({
  validateSearch: tokenSearchSchema,
  component: ResetPassword,
})

function ResetPassword(): ReactNode {
  const { token } = Route.useSearch()
  const [done, setDone] = useState(false)

  const reset = useMutation({
    ...authResetPasswordMutation(),
    onSuccess: () => setDone(true),
  })

  const form = useAppForm({
    defaultValues: { password: '', confirmPassword: '' },
    validators: { onChange: resetPasswordSchema },
    onSubmit: async ({ value }) => {
      // Narrows token to string for the request body; the render guard below already
      // blocks a blank token from ever reaching the form.
      if (!hasText(token)) return
      await submitting(reset.mutateAsync({ body: { token, ...value } }))
    },
  })

  if (!hasText(token)) {
    return (
      <AuthShell
        title="Invalid reset link"
        subtitle="This password reset link is missing or malformed. Request a new one."
        icon={XCircle}
        iconVariant="error"
        footer={
          <Link to="/forgot-password" className={AUTH_LINK_CLASS}>
            Request a new link
          </Link>
        }
      />
    )
  }

  if (done) {
    return (
      <AuthShell
        title="Password updated"
        subtitle="Your password has been reset. You can now sign in."
        icon={CheckCircle2}
        iconVariant="success"
        footer={
          <Link to="/sign-in" className={AUTH_LINK_CLASS}>
            Go to sign in
          </Link>
        }
      />
    )
  }

  return (
    <AuthShell
      title="Set a new password"
      subtitle="Choose a strong password you don't use elsewhere."
    >
      <AuthForm form={form} mutation={reset}>
        <form.AppField name="password">
          {(field) => (
            <field.PasswordField
              label="New password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
          )}
        </form.AppField>
        <form.AppField name="confirmPassword">
          {(field) => (
            <field.PasswordField label="Confirm new password" autoComplete="new-password" />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Reset password" />
        </form.AppForm>
      </AuthForm>
    </AuthShell>
  )
}
