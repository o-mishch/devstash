'use client'

import { useEffect } from 'react'
import { useEditorPreferencesStore } from '@/stores/editor-preferences'
import { useDashboardSectionsStore } from '@/stores/dashboard-sections'
import type { EditorPreferences } from '@/types/editor-preferences'

interface EditorPreferencesInitializerProps {
  preferences: EditorPreferences | null
}

export function EditorPreferencesInitializer({
  preferences,
}: EditorPreferencesInitializerProps) {
  useEffect(() => {
    if (preferences) {
      useEditorPreferencesStore.getState().setPreferences(preferences)
      useDashboardSectionsStore.getState().setSections(preferences.dashboardSections)
    } else {
      useEditorPreferencesStore.setState({ isInitialized: true })
    }
  }, [preferences])

  return null
}
