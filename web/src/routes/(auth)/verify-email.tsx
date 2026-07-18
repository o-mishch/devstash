import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { CheckCircle2, Loader2, MailCheck, XCircle } from 'lucide-react'
import {
  authResendVerificationMutation,
  authVerifyEmailMutation,
} from '@/client/@tanstack/react-query.gen'
import { emailSearchParam, tokenSearchSchema } from '@/auth/search'
import { resendVerificationSchema } from '@/auth/schemas'
import { submitting, useAppForm } from '@/components/form/form-hook'
import { hasText } from '@/lib/utils'
import { AUTH_LINK_CLASS, AuthForm, AuthShell } from '@/components/auth/auth-shell'

export const Route = createFileRoute('/(auth)/verify-email')({
  validateSearch: tokenSearchSchema.extend({ email: emailSearchParam }),
  component: VerifyEmail,
})

function VerifyEmail(): ReactNode {
  const { token, email } = Route.useSearch()

  const verify = useMutation(authVerifyEmailMutation())
  const resendForm = <ResendForm defaultEmail={email} />

  // One-shot verification action fired when the page loads WITH a token. This is a
  // deliberate side effect (a POST), not data loading — a loader would double-fire on
  // intent preload.
  // Track the last token we fired for (not a bare boolean): if the route stays mounted
  // and the token search param changes (A→B), we must verify B too. Same token → no
  // re-fire, which also absorbs React's dev double-invoke. Depend on `verify.mutate`
  // (stable) rather than `verify`, whose identity changes on every mutation state
  // transition and would re-run this effect against nothing but the ref guard.
  const { mutate: fireVerify } = verify
  const firedToken = useRef<string | null>(null)
  useEffect(() => {
    if (hasText(token) && firedToken.current !== token) {
      firedToken.current = token
      fireVerify({ body: { token } })
    }
  }, [token, fireVerify])

  if (hasText(token)) {
    if (verify.isSuccess) {
      return (
        <AuthShell
          title="Email verified"
          subtitle="Your email is confirmed. You can sign in now."
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
    if (verify.isError) {
      return (
        <AuthShell
          title="Verification failed"
          subtitle="This link is invalid or has expired. Request a new one below."
          icon={XCircle}
          iconVariant="error"
        >
          {resendForm}
        </AuthShell>
      )
    }
    return (
      <AuthShell
        title="Verifying your email"
        subtitle="Hang tight for a moment."
        icon={Loader2}
        iconVariant="info"
        iconSpin
      />
    )
  }

  return (
    <AuthShell
      title="Verify your email"
      subtitle="Enter your email to receive a new verification link."
      footer={
        <Link to="/sign-in" className={AUTH_LINK_CLASS}>
          Back to sign in
        </Link>
      }
    >
      {resendForm}
    </AuthShell>
  )
}

interface ResendFormProps {
  defaultEmail?: string | undefined
}

function ResendForm({ defaultEmail }: ResendFormProps): ReactNode {
  const [sent, setSent] = useState(false)
  const resend = useMutation({
    ...authResendVerificationMutation(),
    onSuccess: () => setSent(true),
  })

  const form = useAppForm({
    defaultValues: { email: defaultEmail ?? '' },
    validators: { onChange: resendVerificationSchema },
    onSubmit: async ({ value }) => {
      await submitting(resend.mutateAsync({ body: value }))
    },
  })

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
        <MailCheck className="size-8 text-primary" />
        If that email needs verifying, a new link is on its way.
      </div>
    )
  }

  return (
    <AuthForm form={form} mutation={resend} className="w-full">
      <form.AppField name="email">{(field) => <field.EmailField />}</form.AppField>
      <form.AppForm>
        <form.SubmitButton label="Resend verification link" />
      </form.AppForm>
    </AuthForm>
  )
}
