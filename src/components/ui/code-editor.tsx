'use client'

import { useMemo } from 'react'
import Editor from '@monaco-editor/react'
import { EditorWindowDots } from '@/components/ui/editor-window-dots'
import { CopyButton } from '@/components/shared/copy-button'
import { cn } from '@/lib/utils'
import type { editor } from 'monaco-editor'
import { useEditorPreferences } from '@/components/providers/editor-preferences-provider'
import { monokaiTheme, githubDarkTheme } from '@/lib/utils/monaco-themes'

interface CodeEditorProps {
  value: string
  onChange?: (value: string | undefined) => void
  language?: string | null
  readOnly?: boolean
  className?: string
}

export function CodeEditor({ value, onChange, language, readOnly = false, className }: CodeEditorProps) {
  const monacoLanguage = language || 'plaintext'
  const { preferences } = useEditorPreferences()

  const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(() => ({
    readOnly,
    minimap: { enabled: preferences.minimap },
    scrollBeyondLastLine: false,
    wordWrap: preferences.wordWrap,
    lineNumbers: "on",
    padding: { top: 16, bottom: 16 },
    automaticLayout: true,
    scrollbar: {
      vertical: 'visible',
      horizontal: 'hidden',
      verticalScrollbarSize: 8,
      useShadows: false,
    },
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    fontSize: preferences.fontSize,
    tabSize: preferences.tabSize,
    renderLineHighlight: "none",
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
  }), [readOnly, preferences])

  const handleEditorWillMount = (monaco: any) => {
    monaco.editor.defineTheme('monokai', monokaiTheme as any)
    monaco.editor.defineTheme('github-dark', githubDarkTheme as any)
  }

  return (
    <div className={cn("flex flex-col flex-1 min-h-0 rounded-lg border bg-[#1E1E1E] text-card-foreground shadow-sm overflow-hidden ring-1 ring-white/10 ring-inset", className)}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#2D2D2D] shrink-0">
        <EditorWindowDots />
        
        <div className="flex items-center gap-2">
          {language && (
            <span className="text-xs text-muted-foreground uppercase font-mono px-2 py-0.5 rounded bg-black/20 text-white/70">
              {language}
            </span>
          )}
          <CopyButton
            value={value}
            className="text-muted-foreground hover:text-white hover:bg-white/10"
            title="Copy content"
          />
        </div>
      </div>

      <div className="relative w-full flex-1 min-h-0">
        <div className="absolute inset-0">
          <Editor
            height="100%"
            language={monacoLanguage}
            value={value}
            onChange={onChange}
            theme={preferences.theme}
            options={editorOptions}
            beforeMount={handleEditorWillMount}
          />
        </div>
      </div>
    </div>
  )
}
