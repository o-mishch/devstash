package me

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// updatePreferencesInput is the PATCH /me/preferences body: a partial patch. Every field is a
// pointer so "omitted" (nil) is distinguishable from "set to the zero value" (e.g. minimap:false).
// Only provided fields are merged onto the current prefs; the merged blob is then re-normalized,
// so invalid values clamp to their defaults rather than 422-ing the whole request.
type updatePreferencesInput struct {
	Body struct {
		FontSize         *int    `json:"fontSize,omitempty"`
		TabSize          *int    `json:"tabSize,omitempty"`
		WordWrap         *string `json:"wordWrap,omitempty"`
		Minimap          *bool   `json:"minimap,omitempty"`
		AppTheme         *string `json:"appTheme,omitempty"`
		ColorMode        *string `json:"colorMode,omitempty"`
		EditorThemeMode  *string `json:"editorThemeMode,omitempty"`
		UISkin           *string `json:"uiSkin,omitempty"`
		SidebarCollapsed *bool   `json:"sidebarCollapsed,omitempty"`
	}
}

// registerUpdatePreferences wires PATCH /me/preferences — a partial update. Reads the current
// normalized prefs, merges the provided fields, re-normalizes, writes the merged blob back, and
// returns the updated normalized prefs.
func registerUpdatePreferences(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "update-preferences",
		Method:      http.MethodPatch,
		Path:        "/me/preferences",
		Summary:     "Update the current user's editor preferences",
		Tags:        []string{tagMe},
		Security:    secured(),
	}, func(ctx context.Context, in *updatePreferencesInput) (*preferencesOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)

		blob, err := s.Store.GetEditorPreferences(ctx, userID)
		if err != nil {
			s.Logger.ErrorContext(ctx, "me: update preferences read failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		merged := mergePreferences(normalizeBlob(blob), in)
		normalized := normalize(merged)

		encoded, err := json.Marshal(normalized)
		if err != nil {
			s.Logger.ErrorContext(ctx, "me: update preferences encode failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		if _, err := s.Store.UpdateEditorPreferences(ctx, sqlcdb.UpdateEditorPreferencesParams{
			EditorPreferences: string(encoded), ID: userID,
		}); err != nil {
			s.Logger.ErrorContext(ctx, "me: update preferences write failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		s.Logger.InfoContext(ctx, "me: preferences updated", "userID", userID)
		return &preferencesOutput{Body: normalized}, nil
	})
}

// mergePreferences overlays the provided (non-nil) patch fields onto the current prefs.
func mergePreferences(current EditorPreferences, in *updatePreferencesInput) EditorPreferences {
	b := in.Body
	if b.FontSize != nil {
		current.FontSize = *b.FontSize
	}
	if b.TabSize != nil {
		current.TabSize = *b.TabSize
	}
	if b.WordWrap != nil {
		current.WordWrap = *b.WordWrap
	}
	if b.Minimap != nil {
		current.Minimap = *b.Minimap
	}
	if b.AppTheme != nil {
		current.AppTheme = *b.AppTheme
	}
	if b.ColorMode != nil {
		current.ColorMode = *b.ColorMode
	}
	if b.EditorThemeMode != nil {
		current.EditorThemeMode = *b.EditorThemeMode
	}
	if b.UISkin != nil {
		current.UISkin = *b.UISkin
	}
	if b.SidebarCollapsed != nil {
		current.SidebarCollapsed = *b.SidebarCollapsed
	}
	return current
}
