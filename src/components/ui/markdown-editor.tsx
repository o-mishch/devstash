'use client'

import { useState, Suspense, useRef, useCallback, type PointerEvent } from 'react'
import { Keyboard } from 'lucide-react'
import { EditorChromeShell, EDITOR_CHROME_COPY_BUTTON_CLASS } from '@/components/ui/editor-chrome'
import { CopyButton } from '@/components/shared/copy-button'
import { cn } from '@/lib/utils'
import { useEditorPreferencesStore } from '@/stores/editor-preferences'
import { useEditorBgStyle } from '@/hooks/use-editor-bg-style'
import { MarkdownViewer } from '@/components/shared/dynamic-editors'
import { useIsTouch } from '@/hooks/use-is-touch'

interface MarkdownEditorProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  className?: string
  fullscreenLabel?: string
}

export function MarkdownEditor({ value, onChange, readOnly = false, className, fullscreenLabel }: MarkdownEditorProps) {
  const [activeTabState, setActiveTab] = useState<'write' | 'preview'>('write')
  const activeTab = readOnly ? 'preview' : activeTabState
  const { fontSize, tabSize, wordWrap } = useEditorPreferencesStore()
  const isTouch = useIsTouch()
  const expandRef = useRef<(() => void) | null>(null)
  const triggerExpand = useCallback(() => {
    expandRef.current?.()
  }, [])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyboardButtonPointerDown = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault() // prevent textarea blur before we focus it
    triggerExpand()
    textareaRef.current?.focus()
  }, [triggerExpand])

  const bgStyle = useEditorBgStyle()

  return (
    <EditorChromeShell
      className={className}
      style={bgStyle}
      fullscreenLabel={fullscreenLabel}
      expandRef={expandRef}
      header={
        <div className="flex items-center gap-1">
          {!readOnly && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('write')}
                className={cn(
                  "px-3 py-0.5 text-xs rounded transition-colors",
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
                  "px-3 py-0.5 text-xs rounded transition-colors",
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
            <span className="text-xs text-white/50 px-2 py-0 rounded bg-black/20 uppercase font-mono">
              Markdown
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
      <div className="relative flex-1 min-h-0">
        {activeTab === 'write' ? (
          <>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              placeholder="Write markdown..."
              className="absolute inset-0 w-full h-full resize-none overflow-y-auto font-mono outline-none border-0 p-4 leading-relaxed placeholder:text-muted-foreground/50 bg-transparent"
              style={{
                fontSize: `${fontSize}px`,
                tabSize,
                whiteSpace: wordWrap === 'on' ? 'pre-wrap' : 'pre',
              }}
            />
            {isTouch && !readOnly && fullscreenLabel && (
              <button
                type="button"
                aria-label="Show keyboard"
                className="absolute bottom-2 right-2 z-10 flex items-center justify-center size-8 rounded text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                onPointerDown={handleKeyboardButtonPointerDown}
              >
                <Keyboard className="size-5" />
              </button>
            )}
          </>
        ) : (
          <div className="absolute inset-0 overflow-y-auto">
            <Suspense fallback={
              <pre className="p-4 text-sm font-mono whitespace-pre-wrap leading-relaxed h-full">
                {value}
              </pre>
            }>
              <MarkdownViewer value={value} />
            </Suspense>
          </div>
        )}
      </div>
    </EditorChromeShell>
  )
}
