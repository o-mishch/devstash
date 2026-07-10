'use client'

import { useState, Suspense, useRef, useCallback, useMemo, memo, type PointerEvent } from 'react'
import { Keyboard } from 'lucide-react'
import { EditorChromeShell, EDITOR_CHROME_COPY_BUTTON_CLASS } from '@/components/ui/editor-chrome'
import { CopyButton } from '@/components/shared/copy-button'
import { cn } from '@/lib/utils'
import { useResolvedEditorPreferences } from '@/hooks/editor/use-editor-preferences'
import { useEditorBgStyle } from '@/hooks/editor/use-editor-bg-style'
import { MarkdownViewer } from '@/components/shared/dynamic-editors'
import { useIsTouch } from '@/hooks/ui/use-is-touch'

interface MarkdownEditorProps {
  value: string
  onChange?: (value: string) => void
  readOnly?: boolean
  className?: string
  fullscreenLabel?: string
}

interface TabButtonProps {
  tab: 'write' | 'preview'
  activeTab: 'write' | 'preview'
  onClick: (tab: 'write' | 'preview') => void
}

const TabButton = memo(function TabButton({ tab, activeTab, onClick }: TabButtonProps) {
  const handleClick = useCallback(() => {
    onClick(tab)
  }, [tab, onClick])

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "px-3 py-0.5 text-xs rounded transition-colors capitalize",
        activeTab === tab
          ? "bg-white/15 text-white"
          : "text-white/50 hover:text-white/80"
      )}
    >
      {tab}
    </button>
  )
})

export const MarkdownEditor = memo(function MarkdownEditor({ value, onChange, readOnly = false, className, fullscreenLabel }: MarkdownEditorProps) {
  const [activeTabState, setActiveTab] = useState<'write' | 'preview'>('write')
  const activeTab = readOnly ? 'preview' : activeTabState
  const { fontSize, tabSize, wordWrap } = useResolvedEditorPreferences()
  const isTouch = useIsTouch()
  const expandRef = useRef<(() => void) | null>(null)
  const fullscreenRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // "Show keyboard" button: re-focuses the textarea (summoning the keyboard if it was dismissed)
  // and expands to fullscreen if not already. preventDefault keeps the textarea from blurring
  // before we focus it. The focus() runs synchronously inside this pointer gesture — required for
  // iOS Safari to actually raise the on-screen keyboard.
  const handleKeyboardButtonPointerDown = useCallback((e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    if (!fullscreenRef.current) expandRef.current?.()
    textareaRef.current?.focus()
  }, [])

  const handleTabClick = useCallback((tab: 'write' | 'preview') => {
    setActiveTab(tab)
  }, [])

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange?.(e.target.value)
  }, [onChange])

  const textareaStyle = useMemo(() => ({
    fontSize: `${fontSize}px`,
    tabSize,
    whiteSpace: wordWrap === 'on' ? 'pre-wrap' as const : 'pre' as const,
  }), [fontSize, tabSize, wordWrap])

  const headerRight = useMemo(() => (
    <div className="flex items-center gap-1">
      {!readOnly && (['write', 'preview'] as const).map((tab) => (
        <TabButton
          key={tab}
          tab={tab}
          activeTab={activeTab}
          onClick={handleTabClick}
        />
      ))}
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
  ), [readOnly, activeTab, handleTabClick, value])

  const fallbackEl = useMemo(() => (
    <pre className="p-4 text-sm font-mono whitespace-pre-wrap leading-relaxed h-full">
      {value}
    </pre>
  ), [value])

  const bgStyle = useEditorBgStyle()

  return (
    <EditorChromeShell
      className={className}
      style={bgStyle}
      fullscreenLabel={fullscreenLabel}
      expandRef={expandRef}
      fullscreenRef={fullscreenRef}
      header={headerRight}
    >
      <div className="relative flex-1 min-h-0">
        {activeTab === 'write' ? (
          <>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleTextareaChange}
              placeholder="Write markdown..."
              className="absolute inset-0 w-full h-full resize-none overflow-y-auto font-mono outline-none border-0 p-4 leading-relaxed placeholder:text-muted-foreground/50 bg-transparent"
              style={textareaStyle}
              // The chrome handles tap-to-expand; the textarea's own tap keeps its natural focus
              // so the on-screen keyboard rises and stays up (the node is never remounted).
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
            <Suspense fallback={fallbackEl}>
              <MarkdownViewer value={value} />
            </Suspense>
          </div>
        )}
      </div>
    </EditorChromeShell>
  )
})
