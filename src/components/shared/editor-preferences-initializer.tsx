'use client'

import { useLayoutEffect } from 'react'
import { useHydrateEditorPreferences } from '@/hooks/use-editor-preferences'
import type { EditorPreferences } from '@/types/editor-preferences'

interface EditorPreferencesInitializerProps {
  preferences: EditorPreferences
}

export function EditorPreferencesInitializer({ preferences }: EditorPreferencesInitializerProps) {
  const hydrateEditorPreferences = useHydrateEditorPreferences()

  useLayoutEffect(() => {
    hydrateEditorPreferences(preferences)
  }, [hydrateEditorPreferences, preferences])

  return null
}
