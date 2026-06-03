'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { useTheme } from 'next-themes'
import type { EditorPreferences } from '@/types/editor-preferences'
import { DEFAULT_EDITOR_PREFERENCES } from '@/types/editor-preferences'
import { updateEditorPreferencesAction } from '@/actions/settings'
import { toast } from 'sonner'

interface EditorPreferencesContextValue {
  preferences: EditorPreferences
  updatePreference: <K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) => void
}

const EditorPreferencesContext = createContext<EditorPreferencesContextValue | null>(null)

interface EditorPreferencesProviderProps {
  children: ReactNode
  initialPreferences?: EditorPreferences | null
}

export function EditorPreferencesProvider({ children, initialPreferences }: EditorPreferencesProviderProps) {
  const [preferences, setPreferences] = useState<EditorPreferences>(
    initialPreferences ?? DEFAULT_EDITOR_PREFERENCES
  )
  const { setTheme } = useTheme()

  async function updatePreference<K extends keyof EditorPreferences>(key: K, value: EditorPreferences[K]) {
    const prev = preferences
    const next = { ...prev, [key]: value }
    setPreferences(next)
    
    if (key === 'appTheme') {
      setTheme(value !== 'vscode' ? (value as string) : 'vscode')
    }

    try {
      const res = await updateEditorPreferencesAction(next)
      if (res.status !== 'ok') {
        toast.error(res.message || 'Failed to save preferences')
        setPreferences(prev)
        if (key === 'appTheme') {
          setTheme(prev.appTheme !== 'vscode' ? (prev.appTheme as string) : 'vscode')
        }
      } else {
        toast.success('Preferences saved')
      }
    } catch {
      toast.error('Failed to save preferences')
      setPreferences(prev)
      if (key === 'appTheme') {
        setTheme(prev.appTheme !== 'vscode' ? (prev.appTheme as string) : 'vscode')
      }
    }
  }

  return (
    <EditorPreferencesContext.Provider value={{ preferences, updatePreference }}>
      {children}
    </EditorPreferencesContext.Provider>
  )
}

export function useEditorPreferences() {
  const context = useContext(EditorPreferencesContext)
  if (!context) {
    throw new Error('useEditorPreferences must be used within an EditorPreferencesProvider')
  }
  return context
}
