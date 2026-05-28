'use client'

import { useState, useEffect, useCallback } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { CodeEditor } from '@/components/ui/code-editor'
import { Skeleton } from '@/components/ui/skeleton'
import { ITEM_TYPES_WITH_CODE_EDITOR } from '@/lib/utils/constants'
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
    }).catch(console.error)
    
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

interface ItemContentInputProps {
  itemType: string
  value: string
  onChange: (val: string) => void
  language?: string | null
  id?: string
  placeholder?: string
  codeEditorClassName?: string
  codeEditorWrapperClassName?: string
  textareaClassName?: string
}

export function ItemContentInput({ 
  itemType, 
  value, 
  onChange, 
  language, 
  id,
  placeholder,
  codeEditorClassName,
  codeEditorWrapperClassName,
  textareaClassName
}: ItemContentInputProps) {
  const { resolvedLang, isLoading } = useMonacoLanguage(language)
  const isCodeEditorType = ITEM_TYPES_WITH_CODE_EDITOR.has(itemType)

  const handleMonacoChange = useCallback((val: string | undefined) => {
    onChange(val || '')
  }, [onChange])

  if (isCodeEditorType && isLoading) {
    const skeleton = <Skeleton className={codeEditorClassName || "h-64 w-full"} />
    if (codeEditorWrapperClassName) {
      return <div className={codeEditorWrapperClassName}>{skeleton}</div>
    }
    return skeleton
  }

  const shouldUseMonaco = isCodeEditorType && (resolvedLang !== null || !language)

  if (shouldUseMonaco) {
    const editor = (
      <CodeEditor
        value={value}
        onChange={handleMonacoChange}
        language={resolvedLang}
        className={codeEditorClassName}
      />
    )
    if (codeEditorWrapperClassName) {
      return <div className={codeEditorWrapperClassName}>{editor}</div>
    }
    return editor
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
  const { resolvedLang, isLoading } = useMonacoLanguage(language)
  const isCodeEditorType = ITEM_TYPES_WITH_CODE_EDITOR.has(itemType)

  if (!content) {
    return <p className="text-sm text-muted-foreground">—</p>
  }

  if (isCodeEditorType && isLoading) {
    return <Skeleton className="h-[200px] w-full" />
  }

  const shouldUseMonaco = isCodeEditorType && (resolvedLang !== null || !language)

  if (shouldUseMonaco) {
    return (
      <CodeEditor
        value={content}
        language={resolvedLang}
        readOnly
        className="h-auto"
      />
    )
  }

  return (
    <pre className="flex-1 min-h-0 overflow-auto rounded-md bg-muted p-3 text-xs leading-relaxed whitespace-pre">
      {content}
    </pre>
  )
}
