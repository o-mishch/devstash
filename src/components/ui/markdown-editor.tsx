'use client'

import { useState, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { EditorWindowDots } from '@/components/ui/editor-window-dots'
import { CopyButton } from '@/components/shared/copy-button'
import { cn } from '@/lib/utils'
import { useEditorPreferencesStore } from '@/stores/editor-preferences'
import { EDITOR_THEME_COLORS } from '@/types/editor-preferences'

const MarkdownViewer = dynamic(
  () => import('./markdown-viewer').then(m => m.MarkdownViewer)
)

interface MarkdownEditorProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  className?: string
}

export function MarkdownEditor({ value, onChange, readOnly = false, className }: MarkdownEditorProps) {
  const [activeTabState, setActiveTab] = useState<'write' | 'preview'>('write')
  const activeTab = readOnly ? 'preview' : activeTabState
  const { theme, fontSize, tabSize, wordWrap } = useEditorPreferencesStore()

  const { bg: themeBg, text: themeText } = EDITOR_THEME_COLORS[theme]
  const bgStyle = { backgroundColor: themeBg }

  return (
    <div 
      className={cn("flex flex-col flex-1 min-h-0 rounded-lg border text-card-foreground shadow-sm overflow-hidden ring-1 ring-white/10 ring-inset", className)}
      style={bgStyle}
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#2D2D2D] shrink-0">
        <EditorWindowDots />

        <div className="flex items-center gap-1">
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('write')}
                className={cn(
                  "px-3 py-1 text-xs rounded transition-colors",
                  activeTab === 'write'
                    ? "bg-white/15 text-white"
                    : "text-white/50 hover:text-white/80"
                )}
              >
                Write
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={cn(
                  "px-3 py-1 text-xs rounded transition-colors",
                  activeTab === 'preview'
                    ? "bg-white/15 text-white"
                    : "text-white/50 hover:text-white/80"
                )}
              >
                Preview
              </button>
            </>
          )}
          {readOnly && (
            <span className="text-xs text-white/50 px-2 py-0.5 rounded bg-black/20 uppercase font-mono">
              Markdown
            </span>
          )}
          <CopyButton
            value={value}
            className="text-muted-foreground hover:text-white hover:bg-white/10"
            title="Copy content"
          />
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        {activeTab === 'write' ? (
          <textarea
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            placeholder="Write markdown..."
            className="absolute inset-0 w-full h-full resize-none overflow-y-auto font-mono outline-none border-0 p-4 leading-relaxed placeholder:text-white/30"
            style={{
              fontSize: `${fontSize}px`,
              tabSize,
              whiteSpace: wordWrap === 'on' ? 'pre-wrap' : 'pre',
              backgroundColor: themeBg,
              color: themeText,
            }}
          />
        ) : (
          <div className="absolute inset-0 overflow-y-auto">
            <Suspense fallback={
              <pre className="p-4 text-sm font-mono text-white/90 whitespace-pre-wrap leading-relaxed h-full">
                {value}
              </pre>
            }>
              <MarkdownViewer value={value} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  )
}
