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
  // Code shouldn't wrap by default — long lines scroll horizontally instead. Users can
  // re-enable wrap in Settings → Editor (the toggle still works).
  wordWrap: 'off',
  minimap: false,
  theme: 'vs-dark',
  appTheme: 'vscode',
};

export const EDITOR_THEME_OPTIONS: { value: EditorTheme; label: string }[] = [
  { value: 'vs-dark', label: 'VS Dark' },
  { value: 'monokai', label: 'Monokai' },
  { value: 'github-dark', label: 'GitHub Dark' },
];

export const EDITOR_THEME_COLORS: Record<EditorTheme, { bg: string; text: string }> = {
  'vs-dark':     { bg: '#1E1E1E', text: 'rgba(255, 255, 255, 0.9)' },
  'monokai':     { bg: '#272822', text: '#F8F8F2' },
  'github-dark': { bg: '#24292e', text: '#e1e4e8' },
};

export const APP_THEME_OPTIONS: { value: AppTheme; label: string; description: string }[] = [
  { value: 'vscode', label: 'VS Code', description: 'Dark+ (Default)' },
  { value: 'github', label: 'GitHub', description: 'Cool Blue Dark Mode' },
  { value: 'jetbrains', label: 'JetBrains', description: 'Darcula Warm Dark' },
  { value: 'vercel', label: 'Vercel', description: 'OLED Pitch Black' },
  { value: 'dracula', label: 'Dracula', description: 'Vibrant Purples' },
  { value: 'monokai', label: 'Monokai', description: 'Classic Warm Accents' },
];

/** Tailwind classes for theme picker swatches (avoids inline styles in settings UI). */
export const APP_THEME_SWATCH_CLASSES: Record<AppTheme, { bg: string; accent: string }> = {
  vscode:    { bg: 'bg-zinc-950', accent: 'bg-blue-500' },
  github:    { bg: 'bg-[oklch(0.13_0.012_250)]', accent: 'bg-blue-500' },
  jetbrains: { bg: 'bg-zinc-800', accent: 'bg-amber-500' },
  vercel:    { bg: 'bg-black', accent: 'bg-white' },
  dracula:   { bg: 'bg-[oklch(0.22_0.018_285)]', accent: 'bg-purple-500' },
  monokai:   { bg: 'bg-stone-800', accent: 'bg-pink-500' },
};

export const EDITOR_FONT_SIZE_OPTIONS = [12, 14, 16, 18, 20];

export const EDITOR_TAB_SIZE_OPTIONS = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 8, label: '8 spaces' },
];
