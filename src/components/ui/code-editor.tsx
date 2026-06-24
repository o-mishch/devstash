'use client'

import { useMemo, useEffect, type ReactNode } from 'react'
import Editor, { useMonaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'

import { EditorChromeShell, EDITOR_CHROME_COPY_BUTTON_CLASS } from '@/components/ui/editor-chrome'
import { CopyButton } from '@/components/shared/copy-button'
import { useIsTouch } from '@/hooks/ui/use-is-touch'
import { useResolvedEditorPreferences } from '@/hooks/editor/use-editor-preferences'
import { getDynamicMonacoTheme } from '@/lib/dom/monaco-theme'
import { useEditorBgStyle } from '@/hooks/editor/use-editor-bg-style'

interface CodeEditorProps {
  value: string
  onChange?: (value: string | undefined) => void
  language?: string | null
  readOnly?: boolean
  className?: string
  fullscreenLabel?: string
  // Extra controls rendered at the start of the chrome header (e.g. the drawer's Code/Explain tabs).
  headerStart?: ReactNode
  // When set, renders this in the editor body instead of Monaco (same shell + header) — used to show
  // the AI explanation in place of the code without nesting a second chrome shell.
  bodyOverride?: ReactNode
}

export function CodeEditor({ value, onChange, language, readOnly = false, className, fullscreenLabel, headerStart, bodyOverride }: CodeEditorProps) {
  const monacoLanguage = language || 'plaintext'
  const isTouch = useIsTouch()
  const monaco = useMonaco()

  const { fontSize, minimap, wordWrap, tabSize, colorMode, appTheme, editorThemeMode } = useResolvedEditorPreferences()

  const useMonacoNativeTheme = editorThemeMode !== 'app'
  const monacoNativeColorMode = editorThemeMode === 'dark' ? 'dark' : colorMode
  const editorTheme = useMonacoNativeTheme
    ? (monacoNativeColorMode === 'dark' ? 'vs-dark' : 'vs')
    : 'custom-dynamic'

  // Define and apply dynamic theme when Monaco loads or theme/mode changes
  useEffect(() => {
    if (monaco && !useMonacoNativeTheme) {
      monaco.editor.defineTheme('custom-dynamic', getDynamicMonacoTheme(colorMode))
      monaco.editor.setTheme('custom-dynamic')
    }
  }, [monaco, colorMode, appTheme, useMonacoNativeTheme])

  const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(() => ({
    readOnly,
    minimap: { enabled: minimap },
    scrollBeyondLastLine: false,
    wordWrap,
    lineNumbers: "on",
    lineNumbersMinChars: isTouch ? 2 : 5,
    lineDecorationsWidth: isTouch ? 8 : 10,
    folding: !isTouch,
    glyphMargin: false,
    padding: { top: 16, bottom: 16 },
    automaticLayout: true,
    scrollbar: {
      vertical: 'visible',
      horizontal: 'auto',
      verticalScrollbarSize: 8,
      horizontalScrollbarSize: 8,
      useShadows: false,
    },
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize,
    tabSize,
    renderLineHighlight: "none",
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
  }), [readOnly, fontSize, minimap, wordWrap, tabSize, isTouch])

  const bgStyle = useEditorBgStyle()

  return (
    <EditorChromeShell
      className={className}
      style={bgStyle}
      fullscreenLabel={fullscreenLabel}
      header={
        <div className="flex items-center gap-2">
          {headerStart}
          {language && (
            <span className="text-xs text-muted-foreground uppercase font-mono px-2 py-0 rounded bg-black/20 text-white/70">
              {language}
            </span>
          )}
          <CopyButton
            value={value}
            className={EDITOR_CHROME_COPY_BUTTON_CLASS}
            title="Copy content"
          />
        </div>
      }
    >
      {bodyOverride ?? (
        <div className="relative w-full flex-1 min-h-0">
          <div className="absolute inset-0">
            <Editor
              height="100%"
              language={monacoLanguage}
              value={value}
              onChange={onChange}
              theme={editorTheme}
              options={editorOptions}
              onMount={(editorInstance) => {
                if (!readOnly) return
                // Readonly viewer: tapping the editor must expand (handled by the chrome) but must
                // NEVER raise the on-screen keyboard. Monaco still focuses its hidden textarea on
                // tap, so set inputMode="none" on it — the documented way to keep an element
                // focusable while suppressing the virtual keyboard on iOS/Android.
                const inputArea = editorInstance.getDomNode()?.querySelector<HTMLTextAreaElement>('textarea.inputarea')
                if (inputArea) inputArea.inputMode = 'none'
              }}
            />
          </div>
        </div>
      )}
    </EditorChromeShell>
  )
}
