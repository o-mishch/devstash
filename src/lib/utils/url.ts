// Returns the base URL for the current runtime context.
// On the server, reads NEXTAUTH_URL. In the browser, window.location.origin is used —
// it's the only way to get the canonical origin without a NEXT_PUBLIC_ env var.
export function getBaseUrl(): string {
  if (typeof window !== 'undefined') return window.location.origin
  return process.env.NEXTAUTH_URL || 'http://localhost:3000'
}
