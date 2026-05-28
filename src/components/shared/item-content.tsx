'use client'

import { useState, useEffect, useCallback } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { CodeEditor } from '@/components/ui/code-editor'
import { MarkdownEditor } from '@/components/ui/markdown-editor'
import { Skeleton } from '@/components/ui/skeleton'
import { ITEM_TYPES_WITH_CODE_EDITOR, ITEM_TYPES_WITH_MARKDOWN_EDITOR } from '@/lib/utils/constants'
import { loader } from '@monaco-editor/react'
import type { languages as MonacoLanguages } from 'monaco-editor'

export function useMonacoLanguage(language?: string | null) {
  const [prevLang, setPrevLang] = useState(language)
  const [resolvedLang, setResolvedLang] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(!!language)

  if (language !== prevLang) {
    setPrevLang(language)
    setResolvedLang(null)
    setIsLoading(!!language)
  }

  useEffect(() => {
    if (!language) return

    let isMounted = true

    loader.init().then((monaco) => {
      if (!isMounted) return
      
      const langs = monaco.languages.getLanguages()
      const target = language.toLowerCase().trim()
      
      const match = langs.find((l: MonacoLanguages.ILanguageExtensionPoint) => {
        if (l.id === target) return true
        if (l.aliases && l.aliases.some(a => a.toLowerCase() === target)) return true
        if (l.extensions && l.extensions.some(e => e.toLowerCase() === `.${target}`)) return true
        if (l.aliases && l.aliases.some(a => a.toLowerCase().replace(/^\./, '') === target)) return true
        return false
      })

      setResolvedLang(match ? match.id : null)
      setIsLoading(false)
    }).catch(() => {
      if (!isMounted) return
      setResolvedLang(null)
      setIsLoading(false)
    })

    return () => { isMounted = false }
  }, [language])

  return { resolvedLang, isLoading }
}

export function useMonacoLanguageList() {
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

export function LanguageInput({ id, value, onChange, placeholder = "e.g. typescript, bash", className }: LanguageInputProps) {
  const monacoLanguages = useMonacoLanguageList()
  const listId = id ? `${id}-datalist` : "language-datalist"

  return (
    <>
      <Input
        id={id}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
      />
      <datalist id={listId}>
        {monacoLanguages.map(l => (
          <option key={l} value={l} />
        ))}
      </datalist>
    </>
  )
}

interface CodeEditorInputProps {
  value: string
  onChange: (val: string) => void
  language?: string | null
  contentEditorClassName?: string
  contentEditorWrapperClassName?: string
}

function CodeEditorInput({ value, onChange, language, contentEditorClassName, contentEditorWrapperClassName }: CodeEditorInputProps) {
  const { resolvedLang, isLoading } = useMonacoLanguage(language)

  const handleChange = useCallback((val: string | undefined) => {
    onChange(val || '')
  }, [onChange])

  if (isLoading) {
    const skeleton = <Skeleton className={contentEditorClassName || "h-64 w-full"} />
    if (contentEditorWrapperClassName) {
      return <div className={contentEditorWrapperClassName}>{skeleton}</div>
    }
    return skeleton
  }

  if (resolvedLang !== null || !language) {
    const editor = (
      <CodeEditor
        value={value}
        onChange={handleChange}
        language={resolvedLang}
        className={contentEditorClassName}
      />
    )
    if (contentEditorWrapperClassName) {
      return <div className={contentEditorWrapperClassName}>{editor}</div>
    }
    return editor
  }

  return null
}

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
  textareaClassName
}: ItemContentInputProps) {
  if (ITEM_TYPES_WITH_MARKDOWN_EDITOR.has(itemType)) {
    return <MarkdownEditor value={value} onChange={onChange} className={contentEditorClassName} />
  }

  if (ITEM_TYPES_WITH_CODE_EDITOR.has(itemType)) {
    return (
      <CodeEditorInput
        value={value}
        onChange={onChange}
        language={language}
        contentEditorClassName={contentEditorClassName}
        contentEditorWrapperClassName={contentEditorWrapperClassName}
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
    return <MarkdownEditor value={content} readOnly />
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
