import { SYSTEM_TYPE_ORDER } from './constants'

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Returns the number only when it is strictly positive, else `undefined`. */
export function positiveOrUndefined(value: number | null | undefined): number | undefined {
  return value != null && value > 0 ? value : undefined
}

export function formatDate(date: Date | string, includeYear = false): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(includeYear && { year: 'numeric' }),
  })
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? singular : plural
}

export function itemCountLabel(count: number): string {
  return `${count} ${pluralize(count, 'item')}`
}

export function parseTagString(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

export function getFileExtension(fileName: string): string {
  const base = fileName.trim()
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

function internalPluralize(name: string): string {
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) return name.slice(0, -1) + 'ies'
  if (name.endsWith('s') || name.endsWith('ch') || name.endsWith('sh') || name.endsWith('x') || name.endsWith('z')) return name + 'es'
  return name + 's'
}

export function getTypeLabel(name: string): string {
  if (!name) return ''
  const plural = internalPluralize(name)
  return plural.charAt(0).toUpperCase() + plural.slice(1)
}

export function getTypePlural(name: string): string {
  return name ? internalPluralize(name) : ''
}

export function slugToTypeName(slug: string): string {
  return SYSTEM_TYPE_ORDER.find(t => getTypePlural(t) === slug) ?? slug
}

/**
 * Rolling-window renewal phrasing for the AI usage meter. `resetAt` is an epoch-ms timestamp (when
 * the oldest counted hit slides out of the window). Defensive: a zero, past, or seconds-scale value
 * means nothing is currently counting down, so it reads "renews as you go" rather than rendering
 * negative or absurd time. The window slides continuously, so this is never "resets at midnight".
 */
export function formatRenewIn(resetAt: number): string {
  const now = Date.now()
  if (!resetAt || resetAt <= now) return 'renews as you go'
  const minutes = Math.ceil((resetAt - now) / 60_000)
  return minutes <= 1 ? 'next slot in 1m' : `next slot in ${minutes}m`
}
