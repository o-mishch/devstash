import type { ReactNode } from 'react'
import { oauthStartUrl } from '@/lib/api/config'
import { Button } from '@/components/ui/button'
import GithubMark from '@/assets/icons/github.svg?react'
import GoogleMark from '@/assets/icons/google.svg?react'

// OAuth is a hard cross-origin full-page redirect (justified `window.location` use —
// there is no in-app router target; the browser must leave the SPA to hit Go, which
// bounces to the provider and 302s back with the cookie set).
function startOAuth(provider: 'github' | 'google', redirect?: string): void {
  window.location.assign(oauthStartUrl(provider, redirect))
}

interface OAuthButtonsProps {
  /** Post-auth landing target (already sanitized) threaded through the provider round-trip. */
  redirect?: string
}

export function OAuthButtons({ redirect }: OAuthButtonsProps): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        onClick={() => startOAuth('github', redirect)}
        className="w-full"
      >
        <GithubMark className="size-4" aria-hidden="true" />
        Continue with GitHub
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={() => startOAuth('google', redirect)}
        className="w-full"
      >
        <GoogleMark className="size-4" aria-hidden="true" />
        Continue with Google
      </Button>
    </div>
  )
}

export function AuthDivider(): ReactNode {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs text-muted-foreground/70">or</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}
