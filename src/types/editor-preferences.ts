export const EDITOR_THEMES = ['vs-dark', 'monokai', 'github-dark'] as const;
export type EditorTheme = typeof EDITOR_THEMES[number];

export const APP_THEMES = ['vscode', 'github', 'jetbrains', 'vercel', 'dracula', 'monokai'] as const;
export type AppTheme = typeof APP_THEMES[number];

export interface EditorPreferences {
  fontSize: number;
  tabSize: number;
  wordWrap: 'on' | 'off';
  minimap: boolean;
  theme: EditorTheme;
  appTheme: AppTheme;
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: 'on',
  minimap: false,
  theme: 'vs-dark',
  appTheme: 'vscode',
};

export const EDITOR_THEME_OPTIONS: { value: EditorTheme; label: string }[] = [
  { value: 'vs-dark', label: 'VS Dark' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'github-dark', label: 'GitHub Dark' },
];

export const APP_THEME_OPTIONS: { value: AppTheme; label: string; description: string }[] = [
  { value: 'vscode', label: 'VS Code', description: 'Dark+ (Default)' },
  { value: 'github', label: 'GitHub', description: 'Cool Blue Dark Mode' },
  { value: 'jetbrains', label: 'JetBrains', description: 'Darcula Warm Dark' },
  { value: 'vercel', label: 'Vercel', description: 'OLED Pitch Black' },
  { value: 'dracula', label: 'Dracula', description: 'Vibrant Purples' },
  { value: 'monokai', label: 'Monokai', description: 'Classic Warm Accents' },
];

export const EDITOR_FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20];

export const EDITOR_TAB_SIZE_OPTIONS = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 8, label: '8 spaces' },
];
