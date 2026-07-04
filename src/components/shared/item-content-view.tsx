'use client'

import { type ReactNode, Suspense, useState } from 'react'
import { Sparkles, Crown, Loader2, Save, Check, Wand2, type LucideIcon } from 'lucide-react'
import { EditorChromeShell, EDITOR_CHROME_COPY_BUTTON_CLASS } from '@/components/ui/editor-chrome'
import { CopyButton } from '@/components/shared/copy-button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ITEM_TYPES_WITH_CODE_EDITOR, ITEM_TYPES_WITH_MARKDOWN_EDITOR, aiRateLimitHint } from '@/lib/utils/constants'
import { useMonacoLanguage } from '@/hooks/editor/use-monaco-language'
import { useEditorBgStyle } from '@/hooks/editor/use-editor-bg-style'
import { useIsPro } from '@/hooks/profile/use-user-profile'
import type { AiItemRewriteController } from '@/hooks/ai/use-ai-item-rewrite'
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

type AiContentTab = 'source' | 'result'

interface AiChromeHeaderLabels {
  // Free-user chip + generate-button text (e.g. "Optimize" / "Explain").
  action: string
  generateTooltip: string
  // Tab labels for the original content vs. the AI result.
  sourceTab: string
  resultTab: string
  // Shown once the result is persisted (e.g. "Applied" / "Saved").
  doneLabel: string
  // Persist-button text + tooltip (e.g. "Apply" / "Save").
  applyLabel: string
  applyTooltip: string
}

interface AiChromeHeaderProps {
  // The AI result, or null before it has been generated.
  result: string | null
  isLoading: boolean
  isSaving: boolean
  // True once the result has been persisted to the item.
  isDone: boolean
  onGenerate: () => void
  // Persist entry point (the controller confirms first where required).
  onApply: () => void
  tab: AiContentTab
  onTabChange: (tab: AiContentTab) => void
  labels: AiChromeHeaderLabels
  ApplyIcon: LucideIcon
}

// Shared chrome-header affordance for the AI Explain + Optimize features: a Crown hint for free
// users, a Sparkles generate button before generating, then Source/Result tabs plus a persist button
// once a result exists.
function AiChromeHeader({ result, isLoading, isSaving, isDone, onGenerate, onApply, tab, onTabChange, labels, ApplyIcon }: AiChromeHeaderProps) {
  const isPro = useIsPro()

  if (!isPro) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex cursor-not-allowed items-center gap-1 rounded px-1.5 py-0.5 text-xs text-white/50">
              <Crown className="size-3.5" />
              {labels.action}
            </span>
          }
        />
        <TooltipContent>AI features require Pro subscription</TooltipContent>
      </Tooltip>
    )
  }

  if (result === null) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              onClick={onGenerate}
              disabled={isLoading}
              className="inline-flex items-center gap-1 rounded bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary ring-1 ring-inset ring-primary/40 transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary/15"
            >
              {isLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {labels.action}
            </button>
          }
        />
        <TooltipContent>{labels.generateTooltip}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5 rounded bg-black/20 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => onTabChange('source')}
          aria-pressed={tab === 'source'}
          className={cn('rounded px-2 py-0.5 transition-colors', tab === 'source' ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white/80')}
        >
          {labels.sourceTab}
        </button>
        <button
          type="button"
          onClick={() => onTabChange('result')}
          aria-pressed={tab === 'result'}
          className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 transition-colors', tab === 'result' ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white/80')}
        >
          {isLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          {labels.resultTab}
        </button>
      </div>
      {/* Always rendered while a result exists (both tabs) so toggling never adds or removes this box
          — neighboring controls would otherwise reflow horizontally. */}
      {isDone ? (
        <span className="inline-flex items-center gap-1 px-1 text-[11px] text-white/40">
          <Check className="size-3" />
          {labels.doneLabel}
        </span>
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onApply}
                disabled={isSaving}
                className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary ring-1 ring-inset ring-primary/40 transition-colors hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-primary/15"
              >
                {isSaving ? <Loader2 className="size-3 animate-spin" /> : <ApplyIcon className="size-3" />}
                {labels.applyLabel}
              </button>
            }
          />
          <TooltipContent>{labels.applyTooltip}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

interface MarkdownContentViewProps {
  content: string
  // Drawer read-view only: the AI Optimize controller for prompt items.
  optimize?: AiItemRewriteController
}

function MarkdownContentView({ content, optimize }: MarkdownContentViewProps) {
  const [tab, setTab] = useState<AiContentTab>('source')

  // Surface a freshly generated optimized prompt by switching to its tab; manual toggles still stick.
  // Adjusting state during render (vs. an effect) per the React "previous render" pattern.
  const optimizedPrompt = optimize?.result ?? null
  const [shownOptimized, setShownOptimized] = useState<string | null>(null)
  if (optimizedPrompt !== shownOptimized) {
    setShownOptimized(optimizedPrompt)
    if (optimizedPrompt) setTab('result')
  }

  const shownText = optimize && tab === 'result' && optimizedPrompt !== null ? optimizedPrompt : content

  return (
    <EditorChromeContainer
      minHeight="min-h-[120px]"
      fullscreenLabel="markdown"
      headerRight={
        <div className="flex items-center gap-1">
          {optimize && (
            <AiChromeHeader
              result={optimize.result}
              isLoading={optimize.isLoading}
              isSaving={optimize.isSaving}
              isDone={optimize.isDone}
              onGenerate={() => void optimize.generate()}
              onApply={optimize.requestSave}
              tab={tab}
              onTabChange={setTab}
              ApplyIcon={Wand2}
              labels={{
                action: 'Optimize',
                generateTooltip: `Optimize prompt with AI · ${aiRateLimitHint('optimizations')}`,
                sourceTab: 'Original',
                resultTab: 'Optimized',
                doneLabel: 'Applied',
                applyLabel: 'Apply',
                applyTooltip: 'Replace the prompt with the optimized version',
              }}
            />
          )}
          <span className="text-xs text-white/50 px-2 py-0 rounded bg-black/20 uppercase font-mono">
            Markdown
          </span>
          <CopyButton
            value={shownText}
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
              {shownText}
            </pre>
          }>
            <MarkdownViewer value={shownText} />
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

interface CodeEditorViewProps {
  content: string
  language?: string | null
  explain?: AiItemRewriteController
}

function CodeEditorView({ content, language, explain }: CodeEditorViewProps) {
  const { resolvedLang, isLoading } = useMonacoLanguage(language)
  const [tab, setTab] = useState<AiContentTab>('source')

  // Surface a freshly generated explanation by switching to its tab; manual toggles still stick.
  // Adjusting state during render (vs. an effect) per the React "previous render" pattern.
  const explanation = explain?.result ?? null
  const [shownExplanation, setShownExplanation] = useState<string | null>(null)
  if (explanation !== shownExplanation) {
    setShownExplanation(explanation)
    if (explanation) setTab('result')
  }

  if (isLoading) return <Skeleton className="h-40 w-full" />

  if (resolvedLang !== null || !language) {
    const headerStart = explain ? (
      <AiChromeHeader
        result={explain.result}
        isLoading={explain.isLoading}
        isSaving={explain.isSaving}
        isDone={explain.isDone}
        onGenerate={() => void explain.generate()}
        onApply={explain.requestSave}
        tab={tab}
        onTabChange={setTab}
        ApplyIcon={Save}
        labels={{
          action: 'Explain',
          generateTooltip: `Explain code with AI · ${aiRateLimitHint('explanations')}`,
          sourceTab: 'Code',
          resultTab: 'Explain',
          doneLabel: 'Saved',
          applyLabel: 'Save',
          applyTooltip: 'Save explanation as the item description',
        }}
      />
    ) : null
    const bodyOverride =
      explain && tab === 'result' && explain.result !== null ? (
        <ExplanationBody explanation={explain.result} />
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
  explain?: AiItemRewriteController
  // Drawer read-view only: the AI Optimize controller for prompt (the markdown path).
  optimize?: AiItemRewriteController
}

export function ItemContentView({ itemType, content, language, explain, optimize }: ItemContentViewProps) {
  if (!content) {
    return <p className="text-sm text-muted-foreground">—</p>
  }

  if (ITEM_TYPES_WITH_MARKDOWN_EDITOR.has(itemType)) {
    return <MarkdownContentView content={content} optimize={optimize} />
  }

  if (ITEM_TYPES_WITH_CODE_EDITOR.has(itemType)) {
    return <CodeEditorView content={content} language={language} explain={explain} />
  }

  return <PlainTextView content={content} />
}
