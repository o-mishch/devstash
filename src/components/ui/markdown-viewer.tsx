'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import { useResolvedEditorPreferences } from '@/hooks/use-editor-preferences'

interface MarkdownViewerProps {
  value: string
  className?: string
}

export function MarkdownViewer({ value, className }: MarkdownViewerProps) {
  const { colorMode, editorThemeMode } = useResolvedEditorPreferences()
  const isDark = editorThemeMode === 'dark' || colorMode === 'dark'

  return (
    <div className={cn("h-full overflow-auto p-4", className)}>
      {value ? (
        <div className={cn("prose prose-sm max-w-none", isDark && "prose-invert")}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {value}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">Nothing to preview.</p>
      )}
    </div>
  )
}
