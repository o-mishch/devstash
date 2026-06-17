import type { ReactNode } from 'react'
import { AuthFormLayout, AuthStatusPage, MissingTokenPage } from '@/components/auth/auth-page-header'

interface StatusAction {
  label: string
  href: string
}

interface TokenGatedPageBaseProps {
  token: string | undefined
  missingNoun?: string
  invalidDescription: string
  invalidAction: StatusAction
}

interface TokenGatedPageWithPeekProps extends TokenGatedPageBaseProps {
  peek: (token: string) => Promise<'valid' | 'invalid'>
  title: string
  description: string
  children: (token: string) => ReactNode
  peekPayload?: never
  resolve?: never
}

interface TokenGatedPageWithPayloadProps<TPayload> extends TokenGatedPageBaseProps {
  peekPayload: (token: string) => Promise<TPayload | null>
  resolve: (
    token: string,
    payload: TPayload,
  ) => Promise<{ title: string; description: string; children: ReactNode } | null>
  peek?: never
  title?: never
  description?: never
  children?: never
}

type TokenGatedPageProps<TPayload = never> =
  | TokenGatedPageWithPeekProps
  | TokenGatedPageWithPayloadProps<TPayload>

/**
 * Shell for public, token-gated pages (password reset, credential-email confirm): renders the
 * missing/invalid states, then the form (built with the validated token) when the token is live.
 */
export async function TokenGatedPage<TPayload>(props: TokenGatedPageProps<TPayload>) {
  const { token, missingNoun, invalidDescription, invalidAction } = props

  if (!token) {
    return <MissingTokenPage noun={missingNoun} />
  }

  if ('peekPayload' in props && props.peekPayload && props.resolve) {
    const payload = await props.peekPayload(token)
    if (!payload) {
      return (
        <AuthStatusPage
          variant="error"
          title="Link invalid or expired"
          description={invalidDescription}
          action={invalidAction}
        />
      )
    }

    const resolved = await props.resolve(token, payload)
    if (!resolved) {
      return (
        <AuthStatusPage
          variant="error"
          title="Link invalid or expired"
          description={invalidDescription}
          action={invalidAction}
        />
      )
    }

    const { title, description, children } = resolved
    return (
      <AuthFormLayout title={title} description={description}>
        {children}
      </AuthFormLayout>
    )
  }

  const { peek, title, description, children } = props as TokenGatedPageWithPeekProps

  // Redis-backed token: an absent key can't distinguish expired from already-used from never-valid,
  // so both non-valid outcomes collapse into one state offering a fresh request.
  if ((await peek(token)) !== 'valid') {
    return (
      <AuthStatusPage
        variant="error"
        title="Link invalid or expired"
        description={invalidDescription}
        action={invalidAction}
      />
    )
  }

  return (
    <AuthFormLayout title={title} description={description}>
      {children(token)}
    </AuthFormLayout>
  )
}
