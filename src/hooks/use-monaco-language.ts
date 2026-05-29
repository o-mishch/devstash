import { useState, useEffect } from 'react'
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
