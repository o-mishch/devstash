import type { AppTheme } from './theme-presets.generated';

export { APP_THEMES, APP_THEME_OPTIONS } from './theme-presets.generated';
export type { AppTheme, ThemePresetOption } from './theme-presets.generated';

export type EditorThemeMode = 'app' | 'auto' | 'dark'

export interface DashboardSections {
  collections: boolean;
  pinned: boolean;
  recent: boolean;
}

export interface EditorPreferences {
  fontSize: number;
  tabSize: number;
  wordWrap: 'on' | 'off';
  minimap: boolean;
  appTheme: AppTheme;
  colorMode: 'light' | 'dark';
  editorThemeMode: EditorThemeMode;
  dashboardSections: DashboardSections;
  sidebarCollapsed: boolean;
}
