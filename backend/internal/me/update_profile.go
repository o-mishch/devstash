package me

import (
	"context"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/danielgtaylor/huma/v2"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// updateProfileInput is the PATCH /me/profile body. Name is required-but-nullable: the key must be
// present, and a null/empty value clears the display name (mirrors legacy updateUserName, which
// trims and sets the name). Trimming and the 1–100 length bound are applied in Resolve.
type updateProfileInput struct {
	Body struct {
		Name *string `doc:"Display name; null or empty clears it" json:"name" required:"true"`
	}
}

// Resolve trims the name and enforces the length bound. An empty (post-trim) name becomes nil,
// clearing the stored value; otherwise the trimmed value is written back onto the input.
func (in *updateProfileInput) Resolve(_ huma.Context) []error {
	if in.Body.Name == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*in.Body.Name)
	if utf8.RuneCountInString(trimmed) > userNameMaxChars {
		return []error{&huma.ErrorDetail{
			Location: "body.name",
			Message:  "Name must be at most 100 characters.",
			Value:    *in.Body.Name,
		}}
	}
	if trimmed == "" {
		in.Body.Name = nil
		return nil
	}
	in.Body.Name = &trimmed
	return nil
}

// profileOutput is the PATCH /me/profile response: the updated display fields.
type profileOutput struct {
	Body struct {
		Name  *string `json:"name"`
		Image *string `json:"image"`
	}
}

// registerUpdateProfile wires PATCH /me/profile — update the session user's display name.
func registerUpdateProfile(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "update-profile",
		Method:      http.MethodPatch,
		Path:        "/me/profile",
		Summary:     "Update the current user's profile",
		Tags:        []string{tagMe},
		Security:    secured(),
	}, func(ctx context.Context, in *updateProfileInput) (*profileOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		row, err := s.Store.UpdateUserName(ctx, sqlcdb.UpdateUserNameParams{
			Name: in.Body.Name, ID: userID,
		})
		if err != nil {
			s.Logger.ErrorContext(ctx, "me: update profile failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}
		out := &profileOutput{}
		out.Body.Name = row.Name
		out.Body.Image = row.Image
		s.Logger.InfoContext(ctx, "me: profile updated", "userID", userID)
		return out, nil
	})
}
