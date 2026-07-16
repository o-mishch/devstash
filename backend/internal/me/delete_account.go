package me

import (
	"context"
	"net/http"

	"github.com/danielgtaylor/huma/v2"

	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// noContent is the empty body for the 204 response.
type noContent struct{}

// registerDeleteAccount wires DELETE /me — delete the session user's account. A single scoped
// DELETE FROM users removes the whole account graph: every inbound FK to users is ON DELETE
// CASCADE (accounts, sessions, items, item_types, collections, ai_parse_jobs, …), so no child
// deletes are needed. After the row is gone the current session is destroyed (Redis DEL +
// expired cookie); a destroy failure is logged but does not fail the request, since the account
// is already deleted and the session can no longer resolve its (now missing) user.
func registerDeleteAccount(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "delete-account",
		Method:        http.MethodDelete,
		Path:          "/me",
		Summary:       "Delete the current user's account",
		Tags:          []string{tagMe},
		Security:      secured(),
		DefaultStatus: http.StatusNoContent,
	}, func(ctx context.Context, _ *struct{}) (*noContent, error) {
		userID, _ := middleware.CurrentUserID(ctx)

		if _, err := s.Store.DeleteUser(ctx, userID); err != nil {
			s.Logger.ErrorContext(ctx, "me: delete account failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		if err := s.Sessions.Destroy(ctx); err != nil {
			// The account is already deleted; the session can no longer resolve its user, so
			// treat a destroy failure as degraded-but-handled rather than failing the request.
			s.Logger.WarnContext(ctx, "me: destroy session after account delete failed", "err", err)
		}

		s.Logger.InfoContext(ctx, "me: account deleted", "userID", userID)
		return &noContent{}, nil
	})
}
