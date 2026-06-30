import 'server-only'

// Local-development email transport: send via SMTP to an in-cluster Mailpit so
// outgoing mail is captured in Mailpit's web UI instead of hitting Resend.
//
// Active when SMTP_HOST is set — only the local Secret sets it. This is genuinely
// local-only, NOT "any self-hosted cluster": GCP is a cluster but uses managed Resend
// (no SMTP_HOST), exactly like Vercel. So the gate keys off SMTP_HOST presence, not a
// generic cluster flag. DO NOT reintroduce an EMAIL_LOCAL flag — SMTP_HOST is the
// signal, since the SMTP path cannot run without it anyway.
//
// nodemailer is dynamically imported here so it is never pulled into the production
// code path — on Vercel and GCP this module is never called.
//
// Kept OUT of resend.ts so the production sender stays Resend-only. See
// infra/docs/07-local-run.md.

interface LocalEmailInput {
  from: string
  to: string
  subject: string
  html: string
}

export function isLocalEmailEnabled(): boolean {
  return Boolean(process.env.SMTP_HOST)
}

export async function sendLocalEmail({ from, to, subject, html }: LocalEmailInput): Promise<void> {
  // Dynamic import keeps nodemailer out of the production bundle path.
  const { createTransport } = await import('nodemailer')
  const transport = createTransport({
    host: process.env.SMTP_HOST ?? 'mailpit',
    port: Number(process.env.SMTP_PORT ?? 1025),
    secure: false, // Mailpit dev SMTP is plaintext
  })
  await transport.sendMail({ from, to, subject, html })
}
