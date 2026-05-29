'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { Copy, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EditorWindowDots } from '@/components/ui/editor-window-dots'
import { cn } from '@/lib/utils'

const MarkdownViewer = dynamic(
  () => import('./markdown-viewer').then(m => m.MarkdownViewer),
  { loading: () => <div className="flex h-32 items-center justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> }
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
  const [isCopied, setIsCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 400)}px`
  }, [value, activeTab])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value || '')
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
    } catch {
      // clipboard write failed silently
    }
  }, [value])

  return (
    <div className={cn("flex flex-col rounded-lg border bg-[#1E1E1E] text-card-foreground shadow-sm overflow-hidden ring-1 ring-white/10 ring-inset", className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#2D2D2D]">
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

      {/* Content */}
      {activeTab === 'write' && !readOnly ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder="Write markdown..."
          className="w-full min-h-[100px] resize-none overflow-y-auto bg-[#1E1E1E] text-white/90 text-sm font-mono outline-none border-0 p-4 leading-relaxed placeholder:text-white/30"
        />
      ) : (
        <MarkdownViewer value={value} />
      )}
    </div>
  )
}
