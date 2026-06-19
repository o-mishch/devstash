'use client'

import { type ReactNode, Suspense, useState } from 'react'
import { Sparkles, Crown, Loader2, Save, Check } from 'lucide-react'
import { EditorChromeShell, EDITOR_CHROME_COPY_BUTTON_CLASS } from '@/components/ui/editor-chrome'
import { CopyButton } from '@/components/shared/copy-button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ITEM_TYPES_WITH_CODE_EDITOR, ITEM_TYPES_WITH_MARKDOWN_EDITOR } from '@/lib/utils/constants'
import { useMonacoLanguage } from '@/hooks/use-monaco-language'
import { useEditorBgStyle } from '@/hooks/use-editor-bg-style'
import { useAppUserFlagsStore } from '@/stores/app-user-flags'
import { cn } from '@/lib/utils'
import type { ExplainController } from '@/hooks/use-explain-code'
import { CodeEditor, MarkdownViewer } from './dynamic-editors'

interface EditorChromeContainerProps {
  minHeight?: string
  headerRight: ReactNode
  fullscreenLabel?: string
  children: ReactNode
}

function EditorChromeContainer({ minHeight = 'min-h-[120px]', headerRight, fullscreenLabel, children }: EditorChromeContainerProps) {
  const bgStyle = useEditorBgStyle()

  return (
    <EditorChromeShell style={bgStyle} className={minHeight} header={headerRight} fullscreenLabel={fullscreenLabel}>
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
      fullscreenLabel="content"
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
          <pre className="p-3 text-xs leading-relaxed whitespace-pre font-mono min-h-full">
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
      fullscreenLabel="markdown"
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
            <pre className="p-4 text-sm font-mono whitespace-pre-wrap leading-relaxed h-full">
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

// Markdown-rendered explanation shown in the Explain tab — mirrors MarkdownContentView's scroll body.
function ExplanationBody({ explanation }: { explanation: string }) {
  return (
    <div className="flex-1 min-h-0 relative">
      <div className="absolute inset-0 overflow-auto">
        <Suspense fallback={
          <pre className="p-4 text-sm font-mono whitespace-pre-wrap leading-relaxed h-full">
            {explanation}
          </pre>
        }>
          <MarkdownViewer value={explanation} />
        </Suspense>
      </div>
    </div>
  )
}

type CodeExplainTab = 'code' | 'explain'

interface CodeExplainHeaderProps {
  explain: ExplainController
  tab: CodeExplainTab
  onTabChange: (tab: CodeExplainTab) => void
}

// Chrome-header affordance for the Explain feature: a Crown hint for free users, a Sparkles "Explain"
// button before generating, and Code/Explain tabs once an explanation exists.
function CodeExplainHeader({ explain, tab, onTabChange }: CodeExplainHeaderProps) {
  const { isPro } = useAppUserFlagsStore()

  if (!isPro) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex cursor-not-allowed items-center gap-1 rounded px-1.5 py-0.5 text-xs text-white/50">
              <Crown className="size-3.5" />
              Explain
            </span>
          }
        />
        <TooltipContent>AI features require Pro subscription</TooltipContent>
      </Tooltip>
    )
  }

  if (explain.explanation === null) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={explain.generate}
              disabled={explain.isLoading}
              className="inline-flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-inset ring-primary/40 transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary/15"
            >
              {explain.isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              Explain
            </button>
          }
        />
        <TooltipContent>Explain code with AI</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5 rounded bg-black/20 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => onTabChange('code')}
          aria-pressed={tab === 'code'}
          className={cn('rounded px-2 py-0.5 transition-colors', tab === 'code' ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white/80')}
        >
          Code
        </button>
        <button
          type="button"
          onClick={() => onTabChange('explain')}
          aria-pressed={tab === 'explain'}
          className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors', tab === 'explain' ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white/80')}
        >
          {explain.isLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          Explain
        </button>
      </div>
      {/* Always rendered while an explanation exists (both tabs) so toggling Code/Explain never
          adds or removes this box — neighboring controls would otherwise reflow horizontally. */}
      {explain.isSaved ? (
        <span className="inline-flex items-center gap-1 px-1 text-[11px] text-white/40">
          <Check className="size-3" />
          Saved
        </span>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={explain.requestSave}
                disabled={explain.isSaving}
                className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/40 transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary/15"
              >
                {explain.isSaving ? <Loader2 className="size-3 animate-spin" /> : <Save className="size-3" />}
                Save
              </button>
            }
          />
          <TooltipContent>Save explanation as the item description</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

interface CodeEditorViewProps {
  content: string
  language?: string | null
  explain?: ExplainController
}

function CodeEditorView({ content, language, explain }: CodeEditorViewProps) {
  const { resolvedLang, isLoading } = useMonacoLanguage(language)
  const [tab, setTab] = useState<CodeExplainTab>('code')

  // Surface a freshly generated explanation by switching to its tab; manual toggles still stick.
  // Adjusting state during render (vs. an effect) per the React "previous render" pattern.
  const explanation = explain?.explanation ?? null
  const [shownExplanation, setShownExplanation] = useState<string | null>(null)
  if (explanation !== shownExplanation) {
    setShownExplanation(explanation)
    if (explanation) setTab('explain')
  }

  if (isLoading) return <Skeleton className="h-40 w-full" />

  if (resolvedLang !== null || !language) {
    const headerStart = explain ? (
      <CodeExplainHeader explain={explain} tab={tab} onTabChange={setTab} />
    ) : null
    const bodyOverride =
      explain && tab === 'explain' && explain.explanation !== null ? (
        <ExplanationBody explanation={explain.explanation} />
      ) : undefined

    return (
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <CodeEditor
          value={content}
          language={resolvedLang}
          readOnly
          className="flex-1 min-h-0"
          fullscreenLabel="code"
          headerStart={headerStart}
          bodyOverride={bodyOverride}
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
  // Drawer read-view only: the AI Explain controller for snippet/command (the code-editor path).
  explain?: ExplainController
}

export function ItemContentView({ itemType, content, language, explain }: ItemContentViewProps) {
  if (!content) {
    return <p className="text-sm text-muted-foreground">—</p>
  }

  if (ITEM_TYPES_WITH_MARKDOWN_EDITOR.has(itemType)) {
    return <MarkdownContentView content={content} />
  }

  if (ITEM_TYPES_WITH_CODE_EDITOR.has(itemType)) {
    return <CodeEditorView content={content} language={language} explain={explain} />
  }

  return <PlainTextView content={content} />
}
