export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function getTypeLabel(name: string): string {
  if (!name) return ''
  const capitalized = name.charAt(0).toUpperCase() + name.slice(1)
  if (name.endsWith('y') && !/[aeiou]y$/i.test(name)) {
    return capitalized.slice(0, -1) + 'ies'
  }
  if (name.endsWith('s') || name.endsWith('ch') || name.endsWith('sh') || name.endsWith('x') || name.endsWith('z')) {
    return capitalized + 'es'
  }
  return capitalized + 's'
}
