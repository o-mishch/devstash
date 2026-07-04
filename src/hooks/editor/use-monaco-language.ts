import { useEffect } from 'react'
import { useMonaco, loader } from '@monaco-editor/react'
import type { languages as MonacoLanguages } from 'monaco-editor'

// `@monaco-editor/react`'s `Monaco` type degrades to `any` when monaco-editor's
// ambient types aren't linked; narrow to the exact surface we touch.
export interface MonacoLanguagesApi {
  languages: { getLanguages(): MonacoLanguages.ILanguageExtensionPoint[] }
}

function resolveLanguageSync(monaco: MonacoLanguagesApi, language: string): string | null {
  const langs = monaco.languages.getLanguages()
  const target = language.toLowerCase().trim()

  const match = langs.find((l) => {
    if (l.id === target) return true
    if (l.aliases && l.aliases.some((a) => a.toLowerCase() === target)) return true
    if (l.extensions && l.extensions.some((e) => e.toLowerCase() === `.${target}`)) return true
    return false
  })

  return match ? match.id : null
}

export function useMonacoLanguage(language?: string | null) {
  const monaco = useMonaco()

  useEffect(() => {
    if (language && !monaco) {
      // Fire-and-forget: eagerly kick off Monaco initialization so it's ready
      // when the editor mounts. Errors are surfaced by the Editor component itself.
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
    isLoading: false,
  }
}
