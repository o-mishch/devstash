import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { languages } from '@codemirror/language-data'
import { githubDark, githubLight } from '@uiw/codemirror-theme-github'

export interface CodeEditorProps {
  value: string
  /** Omit for a read-only view; provide to make the editor editable. */
  onChange?: (value: string) => void
  /** Language name/alias (e.g. 'typescript', 'bash') for syntax highlighting; null = plain text. */
  language?: string | null
  colorMode?: 'dark' | 'light'
  fontSize?: number
  tabSize?: number
  wordWrap?: boolean
  minHeight?: string
  maxHeight?: string
}

/**
 * A CodeMirror 6 editor/viewer (via @uiw/react-codemirror) for item content. Lightweight, modern
 * replacement for the legacy Monaco drawer editor. The language grammar is loaded on demand from
 * `@codemirror/language-data` so only the grammars actually used ship. Read-only when `onChange` is
 * omitted. Honors the user's editor preferences (font size, tab size, word wrap) — the same prefs
 * the settings page writes.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  colorMode = 'dark',
  fontSize = 14,
  tabSize = 2,
  wordWrap = false,
  minHeight = '8rem',
  maxHeight = '28rem',
}: CodeEditorProps): ReactNode {
  const languageExt = useLanguageExtension(language)
  const readOnly = onChange === undefined

  const extensions: Extension[] = [...languageExt]
  if (wordWrap) extensions.push(EditorView.lineWrapping)

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      editable={!readOnly}
      readOnly={readOnly}
      theme={colorMode === 'light' ? githubLight : githubDark}
      extensions={extensions}
      basicSetup={{
        lineNumbers: !readOnly,
        foldGutter: false,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
        tabSize,
      }}
      // oxlint-disable-next-line react/forbid-component-props -- caller-sized editor dimensions
      style={{ fontSize, minHeight, maxHeight, overflow: 'auto' }}
      className="rounded-lg border border-border"
    />
  )
}

/** Lazily load the CodeMirror grammar matching `language`; returns [] (plain text) until it resolves. */
function useLanguageExtension(language: string | null | undefined): Extension[] {
  const [ext, setExt] = useState<Extension[]>([])

  useEffect(() => {
    let cancelled = false
    // All state writes happen inside the async callback (after an await) — never synchronously in
    // the effect body — so this doesn't trigger cascading renders.
    const load = async (): Promise<void> => {
      const next = await resolveLanguageExtension(language)
      if (!cancelled) setExt(next)
    }
    void load()
    return (): void => {
      cancelled = true
    }
  }, [language])

  return ext
}

/** Resolve a CodeMirror language grammar by name/alias, or [] for plain text / unknown / failure. */
async function resolveLanguageExtension(language: string | null | undefined): Promise<Extension[]> {
  if (language === null || language === undefined || language === '') return []
  const target = language.toLowerCase()
  const desc = languages.find(
    (l) => l.name.toLowerCase() === target || l.alias.some((a) => a.toLowerCase() === target),
  )
  if (!desc) return []
  try {
    return [await desc.load()]
  } catch {
    // Grammar failed to load — fall back to plain text rather than breaking the editor.
    return []
  }
}
