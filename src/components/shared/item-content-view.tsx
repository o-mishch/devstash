'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'
import { ITEM_TYPES_WITH_CODE_EDITOR, ITEM_TYPES_WITH_MARKDOWN_EDITOR } from '@/lib/utils/constants'
import { useMonacoLanguage } from '@/hooks/use-monaco-language'

const MarkdownViewer = dynamic(
  () => import('@/components/ui/markdown-viewer').then(m => m.MarkdownViewer),
  { loading: () => <Skeleton className="h-[200px] w-full" /> }
)

const CodeEditor = dynamic(
  () => import('@/components/ui/code-editor').then(m => m.CodeEditor),
  { ssr: false, loading: () => <Skeleton className="h-[200px] w-full" /> }
)

interface CodeEditorViewProps {
  content: string
  language?: string | null
}

function CodeEditorView({ content, language }: CodeEditorViewProps) {
  const { resolvedLang, isLoading } = useMonacoLanguage(language)

  if (isLoading) return <Skeleton className="h-[200px] w-full" />

  if (resolvedLang !== null || !language) {
    return (
      <CodeEditor
        value={content}
        language={resolvedLang}
        readOnly
        className="h-auto"
      />
    )
  }

  return null
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
    return <div className="rounded-lg border bg-[#1E1E1E] text-card-foreground shadow-sm overflow-hidden ring-1 ring-white/10 ring-inset"><MarkdownViewer value={content} /></div>
  }

  if (ITEM_TYPES_WITH_CODE_EDITOR.has(itemType)) {
    return <CodeEditorView content={content} language={language} />
  }

  return (
    <pre className="flex-1 min-h-0 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre">
      {content}
    </pre>
  )
}
