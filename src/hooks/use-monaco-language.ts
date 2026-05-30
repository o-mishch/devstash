import { useEffect } from 'react'
import { useMonaco, loader } from '@monaco-editor/react'
import type { languages as MonacoLanguages } from 'monaco-editor'

function resolveLanguageSync(monaco: any, language: string) {
  const langs = monaco.languages.getLanguages()
  const target = language.toLowerCase().trim()
  
  const match = langs.find((l: MonacoLanguages.ILanguageExtensionPoint) => {
    if (l.id === target) return true
    if (l.aliases && l.aliases.some(a => a.toLowerCase() === target)) return true
    if (l.extensions && l.extensions.some(e => e.toLowerCase() === `.${target}`)) return true
    if (l.aliases && l.aliases.some(a => a.toLowerCase().replace(/^\./, '') === target)) return true
    return false
  })

  return match ? match.id : null
}

export function useMonacoLanguage(language?: string | null) {
  const monaco = useMonaco()

  useEffect(() => {
    if (language && !monaco) {
      loader.init().catch(() => {})
    }
  }, [language, monaco])

  if (!language) {
    return { resolvedLang: null, isLoading: false }
  }

  if (!monaco) {
    return { resolvedLang: null, isLoading: true }
  }

  return { 
    resolvedLang: resolveLanguageSync(monaco, language), 
    isLoading: false 
  }
}
