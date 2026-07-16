package me

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// preferencesOutput is the GET/PATCH /me/preferences response: the normalized preferences.
type preferencesOutput struct {
	Body EditorPreferences
}

// registerGetPreferences wires GET /me/preferences — the session user's normalized editor
// preferences. The raw JSONB blob is normalized (defaults + clamp) before returning.
func registerGetPreferences(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "get-preferences",
		Method:      http.MethodGet,
		Path:        "/me/preferences",
		Summary:     "Get the current user's editor preferences",
		Tags:        []string{tagMe},
		Security:    secured(),
	}, func(ctx context.Context, _ *struct{}) (*preferencesOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		blob, err := s.Store.GetEditorPreferences(ctx, userID)
		if err != nil {
			s.Logger.ErrorContext(ctx, "me: get preferences failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		return &preferencesOutput{Body: normalizeBlob(blob)}, nil
	})
}
