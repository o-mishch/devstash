import { APP_THEMES, type AppTheme } from './theme-presets.generated';

export { APP_THEMES, APP_THEME_OPTIONS } from './theme-presets.generated';
export type { AppTheme, ThemePresetOption } from './theme-presets.generated';

export interface EditorPreferences {
  fontSize: number;
  tabSize: number;
  wordWrap: 'on' | 'off';
  minimap: boolean;
  appTheme: AppTheme;
  colorMode: 'light' | 'dark';
  useDefaultEditorTheme: boolean;
}

export const DEFAULT_EDITOR_PREFERENCES: EditorPreferences = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: 'off',
  minimap: false,
  appTheme: 'modern-minimal',
  colorMode: 'dark',
  useDefaultEditorTheme: true,
};

export function normalizeEditorPreferences(input: unknown): EditorPreferences {
  if (!input || typeof input !== 'object') {
    return DEFAULT_EDITOR_PREFERENCES;
  }
  const typed = input as Partial<EditorPreferences>;
  
  const appTheme = (typed.appTheme && (APP_THEMES as readonly string[]).includes(typed.appTheme))
    ? typed.appTheme
    : DEFAULT_EDITOR_PREFERENCES.appTheme;

  const colorMode = (typed.colorMode === 'light' || typed.colorMode === 'dark')
    ? typed.colorMode
    : DEFAULT_EDITOR_PREFERENCES.colorMode;

  return {
    fontSize: typeof typed.fontSize === 'number' && typed.fontSize >= 8 && typed.fontSize <= 100
      ? typed.fontSize
      : DEFAULT_EDITOR_PREFERENCES.fontSize,
    tabSize: typeof typed.tabSize === 'number' && typed.tabSize >= 1 && typed.tabSize <= 16
      ? typed.tabSize
      : DEFAULT_EDITOR_PREFERENCES.tabSize,
    wordWrap: typed.wordWrap === 'on' || typed.wordWrap === 'off'
      ? typed.wordWrap
      : DEFAULT_EDITOR_PREFERENCES.wordWrap,
    minimap: typeof typed.minimap === 'boolean'
      ? typed.minimap
      : DEFAULT_EDITOR_PREFERENCES.minimap,
    appTheme,
    colorMode,
    useDefaultEditorTheme: typeof typed.useDefaultEditorTheme === 'boolean'
      ? typed.useDefaultEditorTheme
      : DEFAULT_EDITOR_PREFERENCES.useDefaultEditorTheme,
  };
}

export const EDITOR_FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20];

export const EDITOR_TAB_SIZE_OPTIONS = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 8, label: '8 spaces' },
];
