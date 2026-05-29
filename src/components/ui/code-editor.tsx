'use client'

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EditorWindowDots } from '@/components/ui/editor-window-dots'
import { cn } from '@/lib/utils'
import type { editor } from 'monaco-editor'

interface CodeEditorProps {
  value: string
  onChange?: (value: string | undefined) => void
  language?: string | null
  readOnly?: boolean
  className?: string
}

export function CodeEditor({ value, onChange, language, readOnly = false, className }: CodeEditorProps) {
  const [isCopied, setIsCopied] = useState(false)
  const [editorHeight, setEditorHeight] = useState(100)
  const disposableRef = useRef<{ dispose: () => void } | null>(null)
  
  const monacoLanguage = language || 'plaintext'

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value || '')
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch {
      // clipboard write failed silently
    }
  }, [value])

  const handleEditorDidMount = useCallback((editorInstance: editor.IStandaloneCodeEditor) => {
    const updateHeight = () => {
      const contentHeight = editorInstance.getContentHeight()
      // Make sure we have a reasonable max height of 400px
      setEditorHeight(Math.min(Math.max(contentHeight + 32, 100), 400))
    }

    disposableRef.current = editorInstance.onDidContentSizeChange(updateHeight)
    updateHeight()
  }, [])

  useEffect(() => {
    return () => {
      if (disposableRef.current) {
        disposableRef.current.dispose()
      }
    }
  }, [])

  const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(() => ({
    readOnly,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    wordWrap: "on",
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
    fontSize: 14,
    renderLineHighlight: "none",
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
  }), [readOnly])

  return (
    <div className={cn("flex flex-col rounded-lg border bg-[#1E1E1E] text-card-foreground shadow-sm overflow-hidden ring-1 ring-white/10 ring-inset", className)}>
      {/* macOS Style Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#2D2D2D]">
        <EditorWindowDots />
        
        <div className="flex items-center gap-2">
          {language && (
            <span className="text-xs text-muted-foreground uppercase font-mono px-2 py-0.5 rounded bg-black/20 text-white/70">
              {language}
            </span>
          )}
          <Button 
            type="button"
            variant="ghost" 
            size="icon" 
            className="size-7 text-muted-foreground hover:text-white hover:bg-white/10"
            onClick={handleCopy}
            title="Copy content"
          >
            {isCopied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
            <span className="sr-only">Copy content</span>
          </Button>
        </div>
      </div>

      {/* Editor Content */}
      <div className="relative w-full" style={{ height: editorHeight }}>
        <Editor
          height="100%"
          language={monacoLanguage}
          value={value}
          onChange={onChange}
          theme="vs-dark"
          onMount={handleEditorDidMount}
          options={editorOptions}
        />
      </div>
    </div>
  )
}
