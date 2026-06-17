import { TokenGatedPage } from '@/components/auth/token-gated-page'
import { peekCredentialEmailPayload } from '@/lib/auth/tokens'
import { getUserAuthMethods } from '@/lib/db/users'
import { primaryEmailMovesWithCredential, credentialEmailPrimaryMoveNote } from '@/lib/utils/auth'
import { TokenPasswordForm } from '@/components/auth/token-password-form'
import { ConfirmEmailChangeForm } from '@/components/auth/confirm-email-change-form'

interface ConfirmLoginEmailPageProps {
  searchParams: Promise<{ token?: string }>
}

const SINGLE_USE_NOTE =
  ' This link works once — if confirmation fails, request a new one from your profile.'

export default async function ConfirmLoginEmailPage({ searchParams }: ConfirmLoginEmailPageProps) {
  const { token } = await searchParams

  return (
    <TokenGatedPage
      token={token}
      peekPayload={peekCredentialEmailPayload}
      missingNoun="confirmation token"
      invalidDescription="This confirmation link is invalid, has expired, or was already used. Request a new one from your profile."
      invalidAction={{ label: 'Go to profile', href: '/profile' }}
      resolve={async (t, payload) => {
        const methods = await getUserAuthMethods(payload.userId)
        if (!methods) return null

        // Derive add-vs-change from the user's CURRENT password state — the same signal
        // `confirmCredentialEmail` uses — so a stale token never shows a form the server rejects.
        const isChange = Boolean(methods.password)
        const primaryMoveNote = credentialEmailPrimaryMoveNote(
          isChange && primaryEmailMovesWithCredential({
            email: methods.email,
            credentialEmail: methods.credentialEmail,
          }),
        )

        return {
          title: isChange ? 'Confirm your new sign-in email' : 'Confirm sign-in email',
          description: isChange
            ? `Confirm to switch your email & password sign-in to this address. Your password and other sign-in methods stay the same.${primaryMoveNote}${SINGLE_USE_NOTE}`
            : `Set a password to finish adding email & password sign-in on this address.${SINGLE_USE_NOTE}`,
          children: isChange ? (
            <ConfirmEmailChangeForm token={t} />
          ) : (
            <TokenPasswordForm
              token={t}
              path="/auth/confirm-login-email"
              successMessage="Sign-in email confirmed! You can now sign in with email & password."
              passwordLabel="Password"
              submitLabel="Confirm & set password"
            />
          ),
        }
      }}
    />
  )
}
