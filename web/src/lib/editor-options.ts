// Editor-preference option lists and free-tier limits. Per-stack copy of the legacy
// src/lib/utils/editor-preferences.ts + constants.ts values (duplicated across the boundary
// rather than imported, per .agents/rules/boundary.md).

export const EDITOR_FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20] as const

export interface TabSizeOption {
  value: number
  label: string
}

export const EDITOR_TAB_SIZE_OPTIONS: TabSizeOption[] = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 8, label: '8 spaces' },
]
