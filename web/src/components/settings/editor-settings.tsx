import type { ReactNode } from 'react'
import { Settings2 } from 'lucide-react'
import { useEditorPreferences, useUpdatePreferences } from '@/hooks/use-preferences'
import { EDITOR_FONT_SIZE_OPTIONS, EDITOR_TAB_SIZE_OPTIONS } from '@/lib/editor-options'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingsSection } from './settings-section'

/**
 * Editor preferences honored by the item drawer's CodeMirror editor: font size, tab size, and
 * word wrap. (The legacy Monaco-only knobs — minimap and editor-theme-mode — are intentionally
 * omitted; CodeMirror derives its theme from the app color mode and has no minimap.)
 */
export function EditorSettings(): ReactNode {
  const { data: prefs } = useEditorPreferences()
  const update = useUpdatePreferences()

  const fontSize = prefs?.fontSize ?? 14
  const tabSize = prefs?.tabSize ?? 2
  const wordWrap = prefs?.wordWrap === 'on'

  return (
    <SettingsSection
      icon={Settings2}
      title="Editor Settings"
      subtitle="Customize the code editor in the item view. Changes are saved automatically."
    >
      <div className="flex flex-col gap-6">
        <PreferenceRow title="Font Size" description="Font size in pixels for the code editor.">
          <Select
            value={String(fontSize)}
            onValueChange={(value) => update.mutate({ body: { fontSize: Number(value) } })}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue>{(value) => `${String(value)}px`}</SelectValue>
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

        <PreferenceRow title="Tab Size" description="Spaces per tab in the code editor.">
          <Select
            value={String(tabSize)}
            onValueChange={(value) => update.mutate({ body: { tabSize: Number(value) } })}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue>
                {(value) =>
                  EDITOR_TAB_SIZE_OPTIONS.find((t) => String(t.value) === String(value))?.label
                }
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

        <PreferenceRow title="Word Wrap" description="Wrap long lines in the code editor.">
          <Switch
            checked={wordWrap}
            onCheckedChange={(checked) =>
              update.mutate({ body: { wordWrap: checked ? 'on' : 'off' } })
            }
          />
        </PreferenceRow>
      </div>
    </SettingsSection>
  )
}

interface PreferenceRowProps {
  title: string
  description: string
  children: ReactNode
}

function PreferenceRow({ title, description, children }: PreferenceRowProps): ReactNode {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label>{title}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="w-full sm:w-auto sm:shrink-0">{children}</div>
    </div>
  )
}
