'use client'

import React, { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { useResolvedEditorPreferences } from '@/hooks/editor/use-editor-preferences'

interface MarkdownViewerProps {
  value: string
  className?: string
}

const REMARK_PLUGINS = [remarkGfm]

export const MarkdownViewer = memo(function MarkdownViewer({ value, className }: MarkdownViewerProps) {
  const { colorMode, editorThemeMode } = useResolvedEditorPreferences()
  const isDark = editorThemeMode === 'dark' || colorMode === 'dark'

  return (
    <div className={cn("h-full overflow-auto p-4", className)}>
      {value ? (
        <div className={cn("prose prose-sm max-w-none", isDark && "prose-invert")}>
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS}>
            {value}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">Nothing to preview.</p>
      )}
    </div>
  )
})
