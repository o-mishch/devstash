'use client'

import { useEditorPreferences } from '@/components/providers/editor-preferences-provider'
import { EDITOR_FONT_SIZE_OPTIONS, EDITOR_TAB_SIZE_OPTIONS, EDITOR_THEME_OPTIONS } from '@/types/editor-preferences'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export function EditorPreferencesForm() {
  const { preferences, updatePreference } = useEditorPreferences()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Code Editor</CardTitle>
        <CardDescription>
          Customize your code editing experience. Changes are saved automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Theme</Label>
            <p className="text-sm text-muted-foreground">Select the editor color theme</p>
          </div>
          <Select 
            value={preferences.theme} 
            onValueChange={(value: any) => updatePreference('theme', value)}
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
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Font Size</Label>
            <p className="text-sm text-muted-foreground">Editor font size in pixels</p>
          </div>
          <Select 
            value={String(preferences.fontSize)} 
            onValueChange={(value) => updatePreference('fontSize', parseInt(value as string, 10))}
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
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Tab Size</Label>
            <p className="text-sm text-muted-foreground">Number of spaces per tab</p>
          </div>
          <Select 
            value={String(preferences.tabSize)} 
            onValueChange={(value) => updatePreference('tabSize', parseInt(value as string, 10))}
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
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Word Wrap</Label>
            <p className="text-sm text-muted-foreground">Wrap lines that exceed the editor width</p>
          </div>
          <Switch 
            checked={preferences.wordWrap === 'on'} 
            onCheckedChange={(checked) => updatePreference('wordWrap', checked ? 'on' : 'off')}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Minimap</Label>
            <p className="text-sm text-muted-foreground">Show code minimap on the right</p>
          </div>
          <Switch 
            checked={preferences.minimap} 
            onCheckedChange={(checked) => updatePreference('minimap', checked)}
          />
        </div>
      </CardContent>
    </Card>
  )
}
