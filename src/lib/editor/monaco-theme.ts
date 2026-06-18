import type { editor } from 'monaco-editor'

// Resolve a CSS custom property to a hex color.
// Reads the raw value directly from <html> (where data-theme is set), then uses a 1×1
// canvas to convert any format (oklch, hsl, rgb, hex) to an RGBA pixel — this is the
// same colour-parsing engine the browser uses for all CSS colour values.
function resolveVarToHex(varName: string): string {
  if (typeof document === 'undefined') return ''
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!raw) return ''
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = raw
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  if (a === 0) return ''
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}

export function getDynamicMonacoTheme(colorMode: 'light' | 'dark'): editor.IStandaloneThemeData {
  const bg       = resolveVarToHex('--background')
  const fg       = resolveVarToHex('--foreground')
  const muted    = resolveVarToHex('--muted')
  const mutedFg  = resolveVarToHex('--muted-foreground')
  const border   = resolveVarToHex('--border')
  const primary  = resolveVarToHex('--primary')
  const accent   = resolveVarToHex('--accent')
  const widgetBg = resolveVarToHex('--popover')
  const widgetFg = resolveVarToHex('--popover-foreground')
  const error    = resolveVarToHex('--destructive')

  // Syntax rules — keywords/storage use primary (brand accent), strings/types/numbers use
  // accent (secondary), comments use muted-fg. Identifiers/functions inherit foreground.
  // inherit: true means unmatched tokens fall through to the base vs/vs-dark rules.
  const rules: editor.ITokenThemeRule[] = [
    ...(fg ? [
      { token: '',                  foreground: fg.slice(1) },
      { token: 'variable',          foreground: fg.slice(1) },
      { token: 'variable.other',    foreground: fg.slice(1) },
      { token: 'identifier',        foreground: fg.slice(1) },
      { token: 'function',          foreground: fg.slice(1) },
      { token: 'operator',          foreground: fg.slice(1) },
    ] : []),
    ...(primary ? [
      { token: 'keyword',           foreground: primary.slice(1), fontStyle: 'bold' },
      { token: 'keyword.control',   foreground: primary.slice(1), fontStyle: 'bold' },
      { token: 'storage.type',      foreground: primary.slice(1) },
      { token: 'storage.modifier',  foreground: primary.slice(1) },
    ] : []),
    ...(accent ? [
      { token: 'string',            foreground: accent.slice(1) },
      { token: 'string.quoted',     foreground: accent.slice(1) },
      { token: 'constant',          foreground: accent.slice(1) },
      { token: 'constant.numeric',  foreground: accent.slice(1) },
      { token: 'number',            foreground: accent.slice(1) },
      { token: 'type',              foreground: accent.slice(1) },
      { token: 'type.identifier',   foreground: accent.slice(1) },
      { token: 'class',             foreground: accent.slice(1) },
    ] : []),
    ...(mutedFg ? [
      { token: 'comment',           foreground: mutedFg.slice(1), fontStyle: 'italic' },
      { token: 'comment.line',      foreground: mutedFg.slice(1), fontStyle: 'italic' },
      { token: 'comment.block',     foreground: mutedFg.slice(1), fontStyle: 'italic' },
      { token: 'punctuation',       foreground: mutedFg.slice(1) },
      { token: 'delimiter',         foreground: mutedFg.slice(1) },
    ] : []),
    ...(error ? [
      { token: 'invalid',           foreground: error.slice(1) },
      { token: 'invalid.illegal',   foreground: error.slice(1) },
    ] : []),
  ]

  const colors: Record<string, string> = {
    // ── Main editor surface ───────────────────────────────────
    ...(bg && { 'editor.background': bg }),
    ...(fg && { 'editor.foreground': fg }),
    // Gutter flush with the editor bg for a seamless look
    ...(bg && { 'editorGutter.background': bg }),

    // ── Line highlight ────────────────────────────────────────
    // muted is a slightly elevated surface in every preset — ideal for the active line
    ...(muted && { 'editor.lineHighlightBackground': muted }),

    // ── Cursor ────────────────────────────────────────────────
    ...(primary && { 'editorCursor.foreground': primary }),
    ...(primary && { 'editorCursor.background': bg || '' }),

    // ── Line numbers ──────────────────────────────────────────
    ...(mutedFg && { 'editorLineNumber.foreground': mutedFg }),
    ...(fg && { 'editorLineNumber.activeForeground': fg }),

    // ── Selection / word highlight ────────────────────────────
    ...(accent && {
      'editor.selectionBackground':          accent + '40',
      'editor.inactiveSelectionBackground':  accent + '20',
      'editor.selectionHighlightBackground': accent + '25',
      'editor.wordHighlightBackground':      accent + '20',
      'editor.wordHighlightStrongBackground':accent + '38',
    }),

    // ── Find match ────────────────────────────────────────────
    ...(primary && {
      'editor.findMatchBackground':          primary + '50',
      'editor.findMatchHighlightBackground': primary + '28',
    }),

    // ── Bracket matching ──────────────────────────────────────
    ...(accent && { 'editorBracketMatch.background': accent + '30' }),
    ...(border && { 'editorBracketMatch.border': border }),

    // ── Indent guides ─────────────────────────────────────────
    ...(border && {
      'editorIndentGuide.background':        border,
      'editorIndentGuide.background1':       border,
    }),
    ...(primary && {
      'editorIndentGuide.activeBackground':  primary,
      'editorIndentGuide.activeBackground1': primary,
    }),

    // ── Whitespace dots ───────────────────────────────────────
    ...(mutedFg && { 'editorWhitespace.foreground': mutedFg + '50' }),

    // ── Widgets: suggestion, hover, find ─────────────────────
    ...(widgetBg && {
      'editorWidget.background':             widgetBg,
      'editorSuggestWidget.background':      widgetBg,
      'editorHoverWidget.background':        widgetBg,
    }),
    ...(widgetFg && {
      'editorWidget.foreground':             widgetFg,
      'editorSuggestWidget.foreground':      widgetFg,
      'editorHoverWidget.foreground':        widgetFg,
    }),
    ...(border && {
      'editorWidget.border':                 border,
      'editorSuggestWidget.border':          border,
      'editorHoverWidget.border':            border,
    }),
    ...(muted && {
      'editorSuggestWidget.selectedBackground': muted,
      'editorHoverWidget.statusBarBackground':  muted,
    }),
    ...(primary && {
      'editorSuggestWidget.highlightForeground':      primary,
      'editorSuggestWidget.focusHighlightForeground': primary,
    }),

    // ── Scrollbar ─────────────────────────────────────────────
    ...(bg && { 'scrollbar.shadow': bg }),
    ...(mutedFg && {
      'scrollbarSlider.background':      mutedFg + '30',
      'scrollbarSlider.hoverBackground': mutedFg + '50',
      'scrollbarSlider.activeBackground':mutedFg + '70',
    }),

    // ── Minimap ───────────────────────────────────────────────
    ...(bg && { 'minimap.background': bg }),
    ...(mutedFg && {
      'minimapSlider.background':        mutedFg + '20',
      'minimapSlider.hoverBackground':   mutedFg + '40',
      'minimapSlider.activeBackground':  mutedFg + '60',
    }),

    // ── Overview ruler ────────────────────────────────────────
    ...(border && { 'editorOverviewRuler.border': border }),
    ...(error && { 'editorOverviewRuler.errorForeground': error }),
    ...(primary && { 'editorOverviewRuler.findMatchForeground': primary + '80' }),

    // ── Error / warning squiggles ─────────────────────────────
    ...(error && { 'editorError.foreground': error }),
  }

  return {
    base: colorMode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules,
    colors,
  }
}
