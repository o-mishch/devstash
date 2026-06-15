'use client'

import { type ReactNode, Suspense } from 'react'
import { EditorChromeShell, EDITOR_CHROME_COPY_BUTTON_CLASS } from '@/components/ui/editor-chrome'
import { CopyButton } from '@/components/shared/copy-button'
import { Skeleton } from '@/components/ui/skeleton'
import { ITEM_TYPES_WITH_CODE_EDITOR, ITEM_TYPES_WITH_MARKDOWN_EDITOR } from '@/lib/utils/constants'
import { useMonacoLanguage } from '@/hooks/use-monaco-language'
import { CodeEditor, MarkdownViewer } from './dynamic-editors'

interface EditorChromeContainerProps {
  minHeight?: string
  headerRight: ReactNode
  children: ReactNode
}

function EditorChromeContainer({ minHeight = 'min-h-[120px]', headerRight, children }: EditorChromeContainerProps) {
  return (
    <EditorChromeShell className={`bg-[#1E1E1E] ${minHeight}`} header={headerRight}>
      {children}
    </EditorChromeShell>
  )
}

interface PlainTextViewProps {
  content: string
}

function PlainTextView({ content }: PlainTextViewProps) {
  return (
    <EditorChromeContainer
      headerRight={
        <CopyButton
          value={content}
          className={EDITOR_CHROME_COPY_BUTTON_CLASS}
          title="Copy content"
        />
      }
    >
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-auto">
          <pre className="p-3 text-xs leading-relaxed whitespace-pre text-white/90 font-mono min-h-full">
            {content}
          </pre>
        </div>
      </div>
    </EditorChromeContainer>
  )
}

interface MarkdownContentViewProps {
  content: string
}

function MarkdownContentView({ content }: MarkdownContentViewProps) {
  return (
    <EditorChromeContainer
      minHeight="min-h-[120px]"
      headerRight={
        <div className="flex items-center gap-1">
          <span className="text-xs text-white/50 px-2 py-0 rounded bg-black/20 uppercase font-mono">
            Markdown
          </span>
          <CopyButton
            value={content}
            className={EDITOR_CHROME_COPY_BUTTON_CLASS}
            title="Copy content"
          />
        </div>
      }
    >
      <div className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-auto">
          <Suspense fallback={
            <pre className="p-4 text-sm font-mono text-white/90 whitespace-pre-wrap leading-relaxed h-full">
              {content}
            </pre>
          }>
            <MarkdownViewer value={content} />
          </Suspense>
        </div>
      </div>
    </EditorChromeContainer>
  )
}

interface CodeEditorViewProps {
  content: string
  language?: string | null
}

function CodeEditorView({ content, language }: CodeEditorViewProps) {
  const { resolvedLang, isLoading } = useMonacoLanguage(language)

  if (isLoading) return <Skeleton className="h-40 w-full" />

  if (resolvedLang !== null || !language) {
    return (
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <CodeEditor
          value={content}
          language={resolvedLang}
          readOnly
          className="flex-1 min-h-0"
        />
      </Suspense>
    )
  }

  return <PlainTextView content={content} />
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
    return <MarkdownContentView content={content} />
  }

  if (ITEM_TYPES_WITH_CODE_EDITOR.has(itemType)) {
    return <CodeEditorView content={content} language={language} />
  }

  return <PlainTextView content={content} />
}
