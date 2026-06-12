import { getTypePlural } from './items'

export function getBaseUrl(): string {
  // On the client, window.location.origin is used so the URL is always correct for
  // the current deployment (localhost, staging, production) without a build-time env var.
  if (typeof window !== 'undefined') return window.location.origin
  return process.env.NEXTAUTH_URL || 'http://localhost:3000'
}

export interface DownloadUrlOptions {
  absolute?: boolean
  preview?: boolean
}

export function getDownloadUrl(itemId: string, absolute?: boolean): string
export function getDownloadUrl(itemId: string, options: DownloadUrlOptions): string
export function getDownloadUrl(
  itemId: string,
  absoluteOrOptions: boolean | DownloadUrlOptions = false,
): string {
  let absolute = false
  let preview = false

  if (typeof absoluteOrOptions === 'boolean') {
    absolute = absoluteOrOptions
  } else {
    absolute = absoluteOrOptions.absolute ?? false
    preview = absoluteOrOptions.preview ?? false
  }

  const query = preview ? '?preview=1' : ''
  const path = `/api/download/${itemId}${query}`
  return absolute ? `${getBaseUrl()}${path}` : path
}

export function getInitialTypeFromPathname(
  pathname: string,
  itemTypes: { name: string }[]
): string | undefined {
  const match = pathname.match(/^\/items\/(\w+)$/)
  return itemTypes.find((t) => getTypePlural(t.name) === match?.[1])?.name
}

export function getCollectionIdFromPathname(pathname: string): string | undefined {
  return pathname.match(/^\/collections\/([^/]+)$/)?.[1]
}
