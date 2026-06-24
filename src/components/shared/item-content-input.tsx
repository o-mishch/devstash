'use client'

import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { ITEM_TYPES_WITH_CODE_EDITOR, ITEM_TYPES_WITH_MARKDOWN_EDITOR, languagesForItemType } from '@/lib/utils/constants'
import { loader } from '@monaco-editor/react'
import type { languages as MonacoLanguages } from 'monaco-editor'
import { useMonacoLanguage } from '@/hooks/editor/use-monaco-language'

import { CodeEditor, MarkdownEditor } from './dynamic-editors'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { ChevronsUpDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

// Visible loading placeholder for code/markdown editors. Uses the Monaco dark background (#1E1E1E)
// so it contrasts against the sheet's bg-popover in dark mode — bg-muted matches bg-popover in the
// default dark theme and would be completely invisible.
function EditorPlaceholder({ className }: { className?: string }) {
  return (
    <div className={cn(
      'flex flex-col overflow-hidden rounded-lg border border-white/10 bg-[#1E1E1E] ring-1 ring-inset ring-white/10',
      className,
    )}>
      <div className="h-7 shrink-0 border-b border-white/10 bg-[#2D2D2D]" />
    </div>
  )
}

function useMonacoLanguageList() {
  const [languages, setLanguages] = useState<string[]>([])

  useEffect(() => {
    let isMounted = true
    loader.init().then((monaco) => {
      if (!isMounted) return
      const langs = monaco.languages.getLanguages()
      const list = new Set<string>()
      langs.forEach((l: MonacoLanguages.ILanguageExtensionPoint) => {
        list.add(l.id)
        if (l.aliases) {
          l.aliases.forEach(a => list.add(a.replace(/^\./, '')))
        }
      })
      setLanguages(Array.from(list).sort())
    }).catch(() => {})

    return () => { isMounted = false }
  }, [])

  return languages
}

interface LanguageInputProps {
  id?: string
  value: string
  onChange: (val: string) => void
  placeholder?: string
  className?: string
  // Restricts the dropdown to the languages valid for this item type: `command` → the shell/CLI set,
  // `snippet` → the full list minus that set. Omitted → the full Monaco list (no filtering).
  itemType?: string
  // 'fill' (default) stretches the trigger + label to fill its container with the chevron pushed to
  // the far edge — the full-width field used in the item forms. 'fit' sizes the trigger to its content
  // (no flex-1 / justify-between) so it reads as a compact pill, matching the drawer's item-type Select.
  fit?: boolean
}

export function LanguageInput({ id, value, onChange, placeholder = "Select language...", className, itemType, fit }: LanguageInputProps) {
  const allLanguages = useMonacoLanguageList()
  // Memoized so the per-type filter only re-runs when the list or item type actually changes — not on
  // every render (e.g. opening/typing in the popover). React Compiler also memoizes, but this keeps the
  // intent explicit and the dependency narrow.
  const monacoLanguages = useMemo(
    () => (itemType ? languagesForItemType(itemType, allLanguages) : allLanguages),
    [itemType, allLanguages],
  )
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        nativeButton={false}
        render={
          <Button
            id={id}
            render={<div />}
            nativeButton={false}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(fit ? "justify-start font-normal" : "w-full justify-between font-normal h-9", className)}
          />
        }
      >
        <span className={cn("truncate text-left", !fit && "flex-1", !value && "text-muted-foreground")}>
          {value ? monacoLanguages.find((lang) => lang === value) || value : placeholder}
        </span>
        <ChevronsUpDown className={cn("size-4 shrink-0 opacity-50", !fit && "ml-2")} />
      </PopoverTrigger>
      {/* initialFocus: on touch/pen, do NOT move focus into the popup on open. Otherwise the
          search CommandInput auto-focuses, which pops the mobile soft keyboard; the bottom-sheet
          then lifts/resizes to clear the keyboard, dragging the field (and this anchored popover)
          upward — the "dropdown jumps up then settles" seen on first open. Desktop keeps the
          default focus-the-input behaviour for type-to-search. */}
      {/* max-h-(--available-height): bound the popup to the space on its chosen side so the list
          scrolls within it instead of overflowing the viewport. Without it, a field low in a short
          mobile sheet leaves too little room either side for the full-height list, so the popup
          spills past the top edge (the search input gets clipped). Matches collection-selector. */}
      <PopoverContent
        className="w-[300px] max-h-(--available-height) overflow-hidden p-0"
        align="start"
        initialFocus={(openType) => openType !== 'touch' && openType !== 'pen'}
      >
        <Command>
          <CommandInput placeholder="Search language..." />
          <CommandList>
            <CommandEmpty>No language found.</CommandEmpty>
            <CommandGroup>
              {monacoLanguages.map((l) => (
                <CommandItem
                  key={l}
                  value={l}
                  onSelect={(currentValue) => {
                    onChange(currentValue === value ? "" : currentValue)
                    setOpen(false)
                  }}
                >
                  <Check className={cn("mr-2 size-4", value === l ? "opacity-100" : "opacity-0")} />
                  {l}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface CodeEditorInputProps {
  value: string
  onChange: (val: string) => void
  language?: string | null
  contentEditorClassName?: string
  contentEditorWrapperClassName?: string
  fullscreenLabel?: string
}

function CodeEditorInput({ value, onChange, language, contentEditorClassName, contentEditorWrapperClassName, fullscreenLabel }: CodeEditorInputProps) {
  const { resolvedLang, isLoading } = useMonacoLanguage(language)

  const handleChange = useCallback((val: string | undefined) => {
    onChange(val || '')
  }, [onChange])

  // bg-muted == bg-popover in the default dark theme, so Skeleton is invisible against the sheet.
  // Use EditorPlaceholder (Monaco dark bg) so the loading state is always visible.
  const placeholderEl = contentEditorWrapperClassName
    ? <div className={contentEditorWrapperClassName}><EditorPlaceholder className={cn('w-full', contentEditorClassName)} /></div>
    : <EditorPlaceholder className={cn('w-full', contentEditorClassName || 'h-40')} />

  if (isLoading) return placeholderEl

  if (resolvedLang !== null || !language) {
    const editor = (
      <Suspense fallback={placeholderEl}>
        <CodeEditor
          value={value}
          onChange={handleChange}
          language={resolvedLang}
          className={contentEditorClassName}
          fullscreenLabel={fullscreenLabel}
        />
      </Suspense>
    )
    if (contentEditorWrapperClassName) {
      return <div className={contentEditorWrapperClassName}>{editor}</div>
    }
    return editor
  }

  return null
}

interface ItemContentInputProps {
  itemType: string
  value: string
  onChange: (val: string) => void
  language?: string | null
  id?: string
  placeholder?: string
  contentEditorClassName?: string
  contentEditorWrapperClassName?: string
  textareaClassName?: string
  // When true the code/markdown editors expose a fullscreen toggle in their chrome header.
  enableFullscreen?: boolean
}

export function ItemContentInput({
  itemType,
  value,
  onChange,
  language,
  id,
  placeholder,
  contentEditorClassName,
  contentEditorWrapperClassName,
  textareaClassName,
  enableFullscreen,
}: ItemContentInputProps) {
  if (ITEM_TYPES_WITH_MARKDOWN_EDITOR.has(itemType)) {
    const markdownFallback = contentEditorWrapperClassName
      ? <div className={contentEditorWrapperClassName}><EditorPlaceholder className={cn('w-full', contentEditorClassName)} /></div>
      : <EditorPlaceholder className={cn('w-full', contentEditorClassName || 'h-40')} />
    const editor = (
      <Suspense fallback={markdownFallback}>
        <MarkdownEditor
          value={value}
          onChange={onChange}
          className={contentEditorClassName}
          fullscreenLabel={enableFullscreen ? 'markdown editor' : undefined}
        />
      </Suspense>
    )
    if (contentEditorWrapperClassName) {
      return <div className={contentEditorWrapperClassName}>{editor}</div>
    }
    return editor
  }

  if (ITEM_TYPES_WITH_CODE_EDITOR.has(itemType)) {
    return (
      <CodeEditorInput
        value={value}
        onChange={onChange}
        language={language}
        contentEditorClassName={contentEditorClassName}
        contentEditorWrapperClassName={contentEditorWrapperClassName}
        fullscreenLabel={enableFullscreen ? 'code editor' : undefined}
      />
    )
  }

  return (
    <Textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={textareaClassName}
    />
  )
}
