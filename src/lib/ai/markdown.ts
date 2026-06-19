// Shared Markdown helper for the AI response parsers (explain / description / optimize). No
// `server-only` import: it carries no secrets and is part of the shared parser exception. [C].

/**
 * Strips a single surrounding Markdown code fence from model output. Models sometimes wrap their
 * whole answer in ```lang … ``` even when told not to. Only strips when the entire (trimmed) string
 * is one fenced block — any language tag (or none) is accepted; inline or partial fences are left
 * untouched. Returns the inner content trimmed, or the trimmed original when there is no wrapping fence.
 */
export function stripMarkdownCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenceMatch = trimmed.match(/^```[^\n`]*\n?([\s\S]*?)\n?```$/)
  return fenceMatch ? fenceMatch[1].trim() : trimmed
}
