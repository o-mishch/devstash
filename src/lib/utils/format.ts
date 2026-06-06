export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(date: Date | string, includeYear = false): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(includeYear && { year: 'numeric' }),
  })
}

export function parseTagString(raw: string | undefined): string[] {
  return (raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}
