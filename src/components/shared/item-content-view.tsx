'use client'

import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { EditorWindowDots } from '@/components/ui/editor-window-dots'
import { PlainTextFallback } from '@/components/shared/plain-text-fallback'
import { ITEM_TYPES_WITH_CODE_EDITOR, ITEM_TYPES_WITH_MARKDOWN_EDITOR } from '@/lib/utils/constants'
import { useMonacoLanguage } from '@/hooks/use-monaco-language'

const MarkdownViewer = dynamic(
  () => import('@/components/ui/markdown-viewer').then(m => m.MarkdownViewer)
)

const CodeEditor = dynamic(
  () => import('@/components/ui/code-editor').then(m => m.CodeEditor),
  { ssr: false }
)


interface CodeEditorViewProps {
  content: string
  language?: string | null
}

function CodeEditorView({ content, language }: CodeEditorViewProps) {
  const { resolvedLang, isLoading } = useMonacoLanguage(language)

  if (isLoading) return <PlainTextFallback content={content} />

  if (resolvedLang !== null || !language) {
    return (
      <Suspense fallback={<PlainTextFallback content={content} />}>
        <CodeEditor
          value={content}
          language={resolvedLang}
          readOnly
          className="h-auto"
        />
      </Suspense>
    )
  }

  return <PlainTextFallback content={content} />
}

interface ItemContentViewProps {
  itemType: string
  content?: string | null
  language?: string | null
}

export function ItemContentView({ itemType, content, language }: ItemContentViewProps) {
  if (!content) {
    return <p className="text-sm text-muted-foreground">—</p>
  }

  if (ITEM_TYPES_WITH_MARKDOWN_EDITOR.has(itemType)) {
    return (
      <div className="flex flex-col rounded-lg border bg-[#1E1E1E] text-card-foreground shadow-sm overflow-hidden ring-1 ring-white/10 ring-inset">
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-[#2D2D2D]">
          <EditorWindowDots />
          <span className="text-xs text-white/50 px-2 py-0.5 rounded bg-black/20 uppercase font-mono">
            Markdown
          </span>
        </div>
        <Suspense fallback={
          <pre className="p-4 text-sm font-mono text-white/90 whitespace-pre-wrap leading-relaxed">
            {content}
          </pre>
        }>
          <MarkdownViewer value={content} />
        </Suspense>
      </div>
    )
  }

  if (ITEM_TYPES_WITH_CODE_EDITOR.has(itemType)) {
    return <CodeEditorView content={content} language={language} />
  }

  return <PlainTextFallback content={content} />
}
