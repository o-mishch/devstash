import { useState } from 'react'
import type { ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { MailCheck } from 'lucide-react'
import { authForgotPasswordMutation } from '@/client/@tanstack/react-query.gen'
import { forgotPasswordSchema } from '@/auth/schemas'
import { submitting, useAppForm } from '@/components/form/form-hook'
import { AUTH_LINK_CLASS, AuthForm, AuthShell } from '@/components/auth/auth-shell'

export const Route = createFileRoute('/(auth)/forgot-password')({
  component: ForgotPassword,
})

function ForgotPassword(): ReactNode {
  const [sent, setSent] = useState(false)

  const forgot = useMutation({
    ...authForgotPasswordMutation(),
    onSuccess: () => setSent(true),
  })

  const form = useAppForm({
    defaultValues: { email: '' },
    validators: { onChange: forgotPasswordSchema },
    onSubmit: async ({ value }) => {
      await submitting(forgot.mutateAsync({ body: value }))
    },
  })

  if (sent) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="If an account exists for that address, we've sent a link to reset your password."
        icon={MailCheck}
        iconVariant="info"
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
      title="Reset your password"
      subtitle="Enter your email and we'll send you a reset link."
      footer={
        <Link to="/sign-in" className={AUTH_LINK_CLASS}>
          Back to sign in
        </Link>
      }
    >
      <AuthForm form={form} mutation={forgot}>
        <form.AppField name="email">{(field) => <field.EmailField />}</form.AppField>
        <form.AppForm>
          <form.SubmitButton label="Send reset link" />
        </form.AppForm>
      </AuthForm>
    </AuthShell>
  )
}
