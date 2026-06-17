'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { ITEM_TYPES_WITH_CODE_EDITOR, ITEM_TYPES_WITH_MARKDOWN_EDITOR } from '@/lib/utils/constants'
import { loader } from '@monaco-editor/react'
import type { languages as MonacoLanguages } from 'monaco-editor'
import { useMonacoLanguage } from '@/hooks/use-monaco-language'

import { CodeEditor, MarkdownEditor } from './dynamic-editors'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { ChevronsUpDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

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
}

export function LanguageInput({ id, value, onChange, placeholder = "Select language...", className }: LanguageInputProps) {
  const monacoLanguages = useMonacoLanguageList()
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
            className={cn("w-full justify-between font-normal h-9", className)}
          />
        }
      >
        <span className={cn("truncate flex-1 text-left", !value && "text-muted-foreground")}>
          {value ? monacoLanguages.find((lang) => lang === value) || value : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0" align="start">
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

  if (isLoading) {
    const fallback = <Skeleton className="h-40 w-full" />
    if (contentEditorWrapperClassName) {
      return <div className={contentEditorWrapperClassName}>{fallback}</div>
    }
    return fallback
  }

  if (resolvedLang !== null || !language) {
    const editor = (
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
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
    const editor = (
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
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
