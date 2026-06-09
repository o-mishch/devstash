'use client'

import type { ReactNode } from 'react'
import { useEditorPreferences } from '@/providers/editor-preferences-provider'
import { EDITOR_FONT_SIZE_OPTIONS, EDITOR_TAB_SIZE_OPTIONS, EDITOR_THEME_OPTIONS, APP_THEME_OPTIONS, APP_THEME_SWATCH_CLASSES, type EditorTheme, type AppTheme } from '@/types/editor-preferences'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

interface PreferenceRowProps {
  title: string
  description: string
  children: ReactNode
}

function PreferenceRow({ title, description, children }: PreferenceRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="space-y-0.5">
        <Label>{title}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  )
}

export function EditorPreferencesForm() {
  const { preferences, updatePreference } = useEditorPreferences()

  const handleNumberChange = (key: 'fontSize' | 'tabSize') => (value: string | null) => {
    if (value) updatePreference(key, parseInt(value, 10))
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">App Theme</CardTitle>
          <CardDescription>
            Choose the global color palette for the application.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {APP_THEME_OPTIONS.map((theme) => {
              const isActive = preferences.appTheme === theme.value;
              const { bg, accent } = APP_THEME_SWATCH_CLASSES[theme.value as AppTheme]
              return (
                <button
                  key={theme.value}
                  onClick={() => updatePreference('appTheme', theme.value)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all hover:bg-foreground/5",
                    isActive ? "border-primary" : "border-border"
                  )}
                >
                  <div
                    className={cn('relative size-10 rounded-full ring-2 ring-border shadow-sm overflow-hidden', bg)}
                  >
                    <div
                      className={cn('absolute bottom-0 right-0 size-4 rounded-tl-full', accent)}
                    />
                  </div>
                  <div className="space-y-0.5 text-center">
                    <p className="text-xs font-semibold leading-none">{theme.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight">{theme.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
      <CardHeader>
        <CardTitle className="text-lg">Code Editor</CardTitle>
        <CardDescription>
          Customize your code editing experience. Changes are saved automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <PreferenceRow title="Theme" description="Select the editor color theme">
          <Select 
            value={preferences.theme} 
            onValueChange={(value: EditorTheme | null) => { if (value) updatePreference('theme', value) }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Theme">
                {EDITOR_THEME_OPTIONS.find((t) => t.value === preferences.theme)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {EDITOR_THEME_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PreferenceRow>

        <PreferenceRow title="Font Size" description="Editor font size in pixels">
          <Select 
            value={String(preferences.fontSize)} 
            onValueChange={handleNumberChange('fontSize')}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Font Size">
                {preferences.fontSize}px
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {EDITOR_FONT_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}px
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PreferenceRow>

        <PreferenceRow title="Tab Size" description="Number of spaces per tab">
          <Select 
            value={String(preferences.tabSize)} 
            onValueChange={handleNumberChange('tabSize')}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Tab Size">
                {EDITOR_TAB_SIZE_OPTIONS.find((t) => t.value === preferences.tabSize)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {EDITOR_TAB_SIZE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PreferenceRow>

        <PreferenceRow title="Word Wrap" description="Wrap lines that exceed the editor width">
          <Switch 
            checked={preferences.wordWrap === 'on'} 
            onCheckedChange={(checked) => updatePreference('wordWrap', checked ? 'on' : 'off')}
          />
        </PreferenceRow>

        <PreferenceRow title="Minimap" description="Show code minimap on the right">
          <Switch 
            checked={preferences.minimap} 
            onCheckedChange={(checked) => updatePreference('minimap', checked)}
          />
        </PreferenceRow>
      </CardContent>
    </Card>
    </div>
  )
}
