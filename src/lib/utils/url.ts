export function getBaseUrl(): string {
  // On the client, window.location.origin is used so the URL is always correct for
  // the current deployment (localhost, staging, production) without a build-time env var.
  if (typeof window !== 'undefined') return window.location.origin
  return process.env.NEXTAUTH_URL || 'http://localhost:3000'
}

export function getDownloadUrl(itemId: string, absolute = false): string {
  const path = `/api/download/${itemId}`
  return absolute ? `${getBaseUrl()}${path}` : path
}
