import type { AppTheme } from './theme-presets.generated';

export { APP_THEMES, APP_THEME_OPTIONS } from './theme-presets.generated';
export type { AppTheme, ThemePresetOption } from './theme-presets.generated';

export {
  UI_SKINS,
  UI_SKIN_OPTIONS,
  DEFAULT_UI_SKIN,
  SKIN_THEME_PRESET,
  isProSkin,
  resolveAccessibleSkin,
} from './ui-skins';
export type { UiSkin, UiSkinTier, UiSkinOption } from './ui-skins';

import type { UiSkin } from './ui-skins';

export type EditorThemeMode = 'app' | 'auto' | 'dark'

export interface EditorPreferences {
  fontSize: number;
  tabSize: number;
  wordWrap: 'on' | 'off';
  minimap: boolean;
  appTheme: AppTheme;
  colorMode: 'light' | 'dark';
  editorThemeMode: EditorThemeMode;
  uiSkin: UiSkin;
  sidebarCollapsed: boolean;
}
