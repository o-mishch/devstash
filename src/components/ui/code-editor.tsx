'use client'

import { useMemo } from 'react'
import Editor, { type BeforeMount } from '@monaco-editor/react'


import { EditorChromeShell, EDITOR_CHROME_COPY_BUTTON_CLASS } from '@/components/ui/editor-chrome'
import { CopyButton } from '@/components/shared/copy-button'
import { cn } from '@/lib/utils'
import type { editor } from 'monaco-editor'
import { useIsTouch } from '@/hooks/use-is-touch'
import { useEditorPreferencesStore } from '@/stores/editor-preferences'
import { monokaiTheme, githubDarkTheme } from '@/lib/editor/monaco-themes'

interface CodeEditorProps {
  value: string
  onChange?: (value: string | undefined) => void
  language?: string | null
  readOnly?: boolean
  className?: string
  fullscreenLabel?: string
}

export function CodeEditor({ value, onChange, language, readOnly = false, className, fullscreenLabel }: CodeEditorProps) {
  const monacoLanguage = language || 'plaintext'
  const isTouch = useIsTouch()
  const { fontSize, minimap, wordWrap, tabSize, theme } = useEditorPreferencesStore()

  const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(() => ({
    readOnly,
    minimap: { enabled: minimap },
    scrollBeyondLastLine: false,
    wordWrap,
    lineNumbers: "on",
    // Mobile: reclaim the wide line-number gutter (Monaco defaults are tuned for desktop) —
    // tighter number column, no decoration/folding margins. Desktop keeps the defaults so it
    // stays pixel-identical (lineNumbersMinChars 5, lineDecorationsWidth 10, folding on).
    lineNumbersMinChars: isTouch ? 2 : 5,
    lineDecorationsWidth: isTouch ? 8 : 10,
    folding: !isTouch,
    glyphMargin: false,
    padding: { top: 16, bottom: 16 },
    automaticLayout: true,
    scrollbar: {
      vertical: 'visible',
      // 'auto': when word wrap is off, long lines overflow and need a horizontal scrollbar.
      // Previously 'hidden' trapped the overflow with no way to scroll to it.
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

  const handleEditorWillMount: BeforeMount = (monaco) => {
    monaco.editor.defineTheme('monokai', monokaiTheme as editor.IStandaloneThemeData)
    monaco.editor.defineTheme('github-dark', githubDarkTheme as editor.IStandaloneThemeData)
  }

  return (
    <EditorChromeShell
      className={cn('bg-[#1E1E1E]', className)}
      fullscreenLabel={fullscreenLabel}
      header={
        <div className="flex items-center gap-2">
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
      <div className="relative w-full flex-1 min-h-0">
        <div className="absolute inset-0">
          <Editor
            height="100%"
            language={monacoLanguage}
            value={value}
            onChange={onChange}
            theme={theme}
            options={editorOptions}
            beforeMount={handleEditorWillMount}
          />
        </div>
      </div>
    </EditorChromeShell>
  )
}
