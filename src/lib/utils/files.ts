export function getFileExtension(fileName: string): string {
  const base = fileName.trim()
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}
