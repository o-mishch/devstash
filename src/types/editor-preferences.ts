export const EDITOR_THEMES = ['vs-dark', 'monokai', 'github-dark'] as const;
export type EditorTheme = typeof EDITOR_THEMES[number];

export interface EditorPreferences {
  fontSize: number;
  tabSize: number;
  wordWrap: 'on' | 'off';
  minimap: boolean;
  theme: EditorTheme;
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: 'on',
  minimap: false,
  theme: 'vs-dark',
};

export const EDITOR_THEME_OPTIONS: { value: EditorTheme; label: string }[] = [
  { value: 'vs-dark', label: 'VS Dark' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'github-dark', label: 'GitHub Dark' },
];

export const EDITOR_FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20];

export const EDITOR_TAB_SIZE_OPTIONS = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 8, label: '8 spaces' },
];
