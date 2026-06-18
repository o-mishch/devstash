'use client'

import type { ReactNode } from 'react'
import { useEditorPreferencesStore } from '@/stores/editor-preferences'
import {
  EDITOR_FONT_SIZE_OPTIONS,
  EDITOR_TAB_SIZE_OPTIONS,
  APP_THEME_OPTIONS,
  DEFAULT_EDITOR_PREFERENCES,
  type AppTheme
} from '@/types/editor-preferences'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { startThemeTransition, type TransitionEventCoords } from '@/lib/utils/theme-transition'
import { RotateCcw } from 'lucide-react'
import { DarkLightSwitch } from '@/components/shared/dark-light-switch'

interface PreferenceRowProps {
  title: string
  description: string
  children: ReactNode
}

function PreferenceRow({ title, description, children }: PreferenceRowProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label>{title}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function EditorPreferencesForm() {
  const store = useEditorPreferencesStore()
  const { updatePreference, updatePreferences } = store

  const handleAppThemeChange = (e: TransitionEventCoords, theme: AppTheme) => {
    startThemeTransition(e, () => {
      void updatePreference('appTheme', theme)
    })
  }

  const handleReset = (e: TransitionEventCoords) => {
    startThemeTransition(e, () => {
      void updatePreferences(DEFAULT_EDITOR_PREFERENCES)
    })
  }


  const isDark = store.colorMode === 'dark'

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">App Theme</CardTitle>
          <CardDescription>
            Choose the global color palette and mode for the application.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-h-[256px] overflow-y-auto pr-1">
          <div className="app-grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
            {APP_THEME_OPTIONS.map((theme) => {
              const isActive = store.appTheme === theme.value
              const colors = isDark ? theme.dark : theme.light
              return (
                <button
                  key={theme.value}
                  onClick={(e) => handleAppThemeChange(e, theme.value)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border-2 p-3 transition-all hover:bg-foreground/5 cursor-pointer",
                    isActive ? "border-primary bg-foreground/5" : "border-border"
                  )}
                >
                  <div
                    className="relative size-10 rounded-full ring-2 ring-border/20 shadow-sm overflow-hidden shrink-0"
                    style={{ backgroundColor: colors.bg }}
                  >
                    <div
                      className="absolute bottom-0 right-0 size-4 rounded-tl-full"
                      style={{ backgroundColor: colors.primary }}
                    />
                  </div>
                  <div className="space-y-0.5 text-center min-w-0 w-full">
                    <p className="text-xs font-semibold leading-none truncate">{theme.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-tight truncate">{theme.description}</p>
                  </div>
                </button>
              )
            })}
          </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
            <Label>Color Mode</Label>
            <div className="flex items-center gap-3">
              <DarkLightSwitch
                colorMode={store.colorMode}
                onColorModeChange={(mode) => void updatePreference('colorMode', mode)}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="gap-1.5"
                title="Revert all theme settings to defaults"
              >
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Editor Settings</CardTitle>
          <CardDescription>
            Customize your editing experience. Changes are saved automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <PreferenceRow title="Use Default Editor Theme" description="Use native light/dark styles for code and markdown editors, ignoring the app theme">
            <Switch
              checked={store.useDefaultEditorTheme}
              onCheckedChange={(checked) => updatePreference('useDefaultEditorTheme', checked)}
            />
          </PreferenceRow>

          <PreferenceRow title="Font Size" description="Font size in pixels — code and markdown editors">
            <Select
              value={String(store.fontSize)}
              onValueChange={(v) => { if (v) void updatePreference('fontSize', parseInt(v, 10)) }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Font Size">
                  {store.fontSize}px
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

          <PreferenceRow title="Tab Size" description="Spaces per tab — code and markdown editors">
            <Select
              value={String(store.tabSize)}
              onValueChange={(v) => { if (v) void updatePreference('tabSize', parseInt(v, 10)) }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Tab Size">
                  {EDITOR_TAB_SIZE_OPTIONS.find((t) => t.value === store.tabSize)?.label}
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

          <PreferenceRow title="Word Wrap" description="Wrap long lines — code and markdown editors">
            <Switch
              checked={store.wordWrap === 'on'}
              onCheckedChange={(checked) => updatePreference('wordWrap', checked ? 'on' : 'off')}
            />
          </PreferenceRow>

          <PreferenceRow title="Minimap" description="Show code minimap on the right — code editor only">
            <Switch
              checked={store.minimap}
              onCheckedChange={(checked) => updatePreference('minimap', checked)}
            />
          </PreferenceRow>
        </CardContent>
      </Card>
    </div>
  )
}
