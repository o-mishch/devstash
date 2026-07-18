const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** Compact relative time, e.g. "3 days ago" / "just now". */
export function relativeTime(iso: string): string {
  const diffSeconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
  // An unparseable timestamp yields NaN — surface nothing rather than a fake "just now".
  if (Number.isNaN(diffSeconds)) return ''
  const match = UNITS.find(([, secs]) => Math.abs(diffSeconds) >= secs)
  if (!match) return 'just now'
  return rtf.format(Math.round(diffSeconds / match[1]), match[0])
}
