/** First non-blank line as a label, capped; fallback to a timestamped name for blank-ish content. */
export function deriveSourceLabel(text: string, maxChars: number): string {
  const firstLine = text.split('\n').find((line) => line.trim().length > 0)?.trim()
  return firstLine ? firstLine.slice(0, maxChars) : `brain-dump-${Date.now()}`
}
