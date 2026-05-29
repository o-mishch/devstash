'use client'

import { useState, useEffect, useCallback } from 'react'
import dynamic from 'next/dynamic'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ITEM_TYPES_WITH_CODE_EDITOR, ITEM_TYPES_WITH_MARKDOWN_EDITOR } from '@/lib/utils/constants'
import { loader } from '@monaco-editor/react'
import type { languages as MonacoLanguages } from 'monaco-editor'
import { useMonacoLanguage } from '@/hooks/use-monaco-language'

const MarkdownEditor = dynamic(
  () => import('@/components/ui/markdown-editor').then(m => m.MarkdownEditor),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> }
)

const CodeEditor = dynamic(
  () => import('@/components/ui/code-editor').then(m => m.CodeEditor),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full" /> }
)

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
