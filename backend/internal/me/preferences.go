package me

import (
	"encoding/json"
	"regexp"
	"slices"
)

// EditorPreferences is the normalized preferences contract shared with the SPA. The JSON field
// names MUST match web/src/types/editor-preferences.ts exactly — this is the wire shape the
// generated Hey API client binds to. Huma keys the OpenAPI component off this Go base name, so
// it is defined once (unique component name "EditorPreferences").
type EditorPreferences struct {
	FontSize         int    `json:"fontSize"`
	TabSize          int    `json:"tabSize"`
	WordWrap         string `json:"wordWrap"`
	Minimap          bool   `json:"minimap"`
	AppTheme         string `json:"appTheme"`
	ColorMode        string `json:"colorMode"`
	EditorThemeMode  string `json:"editorThemeMode"`
	UISkin           string `json:"uiSkin"`
	SidebarCollapsed bool   `json:"sidebarCollapsed"`
}

// Enum values and bounds, mirroring src/lib/utils/editor-preferences.ts. Named so normalize and
// defaultPreferences share one source of truth (and to keep repeated literals out of the file).
const (
	wordWrapOn  = "on"
	wordWrapOff = "off"

	colorModeLight = "light"
	colorModeDark  = "dark"

	themeModeApp  = "app"
	themeModeAuto = "auto"
	themeModeDark = "dark"

	defaultAppTheme = "modern-minimal"
	defaultUISkin   = "classic"

	fontSizeMin = 8
	fontSizeMax = 100
	tabSizeMin  = 1
	tabSizeMax  = 16

	defaultFontSize = 14
	defaultTabSize  = 2
)

// uiSkins is the set of valid UI skins. Mirrors src/types/ui-skins.ts UI_SKINS
// (and web/src/types/ui-skins.ts) — kept in sync by value. An unknown/removed skin in an old
// blob falls back to the default (classic).
var uiSkins = []string{
	"classic",
	"aurora",
	"editorial",
	"spatial",
	"command-deck",
	"orbital",
	"mission-control",
	"neon-grid",
	"holographic",
}

// appThemeRe validates an appTheme slug. The 51 themes are generated (theme-presets.generated),
// so rather than enumerate them we accept any slug in this shape; anything else falls back to the
// default. Mirrors normalizeEditorPreferences' appTheme handling in src/lib/utils/editor-preferences.ts.
var appThemeRe = regexp.MustCompile(`^[a-z0-9-]{1,50}$`)

// defaultPreferences returns the DEFAULT_EDITOR_PREFERENCES (mirrors
// src/lib/utils/editor-preferences.ts).
func defaultPreferences() EditorPreferences {
	return EditorPreferences{
		FontSize:         defaultFontSize,
		TabSize:          defaultTabSize,
		WordWrap:         wordWrapOff,
		Minimap:          false,
		AppTheme:         defaultAppTheme,
		ColorMode:        colorModeDark,
		EditorThemeMode:  themeModeApp,
		UISkin:           defaultUISkin,
		SidebarCollapsed: false,
	}
}

// normalize applies defaults and clamps every field to its valid range/enum, falling back to the
// default for any out-of-range or unknown value (never rejecting the whole blob). This mirrors
// normalizeEditorPreferences in src/lib/utils/editor-preferences.ts. Bool fields are always valid,
// so they carry through as-is.
func normalize(p EditorPreferences) EditorPreferences {
	out := defaultPreferences()

	if p.FontSize >= fontSizeMin && p.FontSize <= fontSizeMax {
		out.FontSize = p.FontSize
	}
	if p.TabSize >= tabSizeMin && p.TabSize <= tabSizeMax {
		out.TabSize = p.TabSize
	}
	if p.WordWrap == wordWrapOn || p.WordWrap == wordWrapOff {
		out.WordWrap = p.WordWrap
	}
	out.Minimap = p.Minimap
	if appThemeRe.MatchString(p.AppTheme) {
		out.AppTheme = p.AppTheme
	}
	if p.ColorMode == colorModeLight || p.ColorMode == colorModeDark {
		out.ColorMode = p.ColorMode
	}
	if p.EditorThemeMode == themeModeApp || p.EditorThemeMode == themeModeAuto || p.EditorThemeMode == themeModeDark {
		out.EditorThemeMode = p.EditorThemeMode
	}
	if slices.Contains(uiSkins, p.UISkin) {
		out.UISkin = p.UISkin
	}
	out.SidebarCollapsed = p.SidebarCollapsed

	return out
}

// normalizeBlob decodes the raw JSONB preferences column and normalizes it. A nil/empty blob (a
// NULL column, i.e. a user who never saved prefs) or one that can't decode into the expected
// shape yields the defaults — mirroring the TS normalizer's "not an object → defaults" branch.
func normalizeBlob(blob []byte) EditorPreferences {
	if len(blob) == 0 {
		return defaultPreferences()
	}
	var p EditorPreferences
	if err := json.Unmarshal(blob, &p); err != nil {
		return defaultPreferences()
	}
	return normalize(p)
}
