package items

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	"github.com/o-mishch/devstash/backend/internal/apitypes"
	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// updateItemInput is the PATCH /items/{id} body (itemMutationSchema). ItemTypeName is the
// optional v3 retype target — Huma's enum rejects a non-text target (link/file/image) with a
// 422 before the handler runs; the handler additionally guards the source type. Body
// normalization/validation runs in Resolve; the auth/Pro/retype-source gates stay in the
// handler (they need DB reads and non-422 statuses).
type updateItemInput struct {
	// ID inlined (not embedded idPath): Huma drops an anonymously embedded path struct
	// from the OpenAPI params when the input also has a Body. See items/favorite.go.
	ID string `doc:"Item id" path:"id"`

	Body struct {
		Title         string   `json:"title"                       minLength:"1"                 required:"true"`
		Description   *string  `json:"description,omitempty"`
		Content       *string  `json:"content,omitempty"`
		URL           *string  `json:"url,omitempty"`
		Language      *string  `json:"language,omitempty"`
		Tags          []string `json:"tags,omitempty"`
		CollectionIDs []string `json:"collectionIds,omitempty"`
		ItemTypeName  *string  `enum:"snippet,prompt,command,note" json:"itemTypeName,omitempty"`
	}
}

// Resolve normalizes and validates the update body in place (parity with itemMutationSchema).
func (in *updateItemInput) Resolve(_ huma.Context) []error {
	var errs []error
	b := &in.Body

	b.Title = strings.TrimSpace(b.Title)
	if b.Title == "" {
		errs = append(errs, &huma.ErrorDetail{Location: "body.title", Message: "Title is required"})
	}
	if err := validateDescriptionField(&b.Description, "body.description"); err != nil {
		errs = append(errs, err)
	}
	if err := normalizeURLField(&b.URL, "body.url"); err != nil {
		errs = append(errs, err)
	}
	b.Content = normalizeOptional(b.Content)
	b.Language = normalizeOptional(b.Language)
	b.Tags = normalizeTags(b.Tags)
	if b.CollectionIDs == nil {
		b.CollectionIDs = []string{}
	}
	return errs
}

// itemSavedDetails is the ItemSavedDetails wire shape returned by PATCH /items/{id}.
type itemSavedDetails struct {
	Description *string         `json:"description"`
	UpdatedAt   time.Time       `json:"updatedAt"`
	Collections []collectionRef `json:"collections"`
	URL         *string         `json:"url"`
	Tags        []string        `json:"tags"`
	IsFavorite  bool            `json:"isFavorite"`
	IsPinned    bool            `json:"isPinned"`
}

type updateItemOutput struct {
	Body itemSavedDetails
}

// registerUpdate wires PATCH /items/{id}. Order (parity with the route handler): rate-limit →
// validate → load-for-auth (404) → Pro gate (403) → source-type retype guard (422) → resolve
// target type + remapped language → update.
func registerUpdate(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "update-item",
		Method:      http.MethodPatch,
		Path:        "/items/{id}",
		Summary:     "Update an item",
		Tags:        []string{tagItems},
		Security:    secured(),
	}, func(ctx context.Context, in *updateItemInput) (*updateItemOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		if err := s.enforceItemMutation(ctx, userID); err != nil {
			return nil, err
		}

		body := in.Body
		existing, err := s.Store.GetItemForAuth(ctx, sqlcdb.GetItemForAuthParams{ID: in.ID, Owner: userID})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, huma.Error404NotFound(itemNotFoundMessage)
			}
			s.Logger.ErrorContext(ctx, "update item: load failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		if proItemTypeNames.has(existing.ItemTypeName) && !isPro(ctx) {
			return nil, huma.Error403Forbidden("Upgrade to Pro to edit " + proItemTypeNamesLabel + ".")
		}

		// v3 retype: the enum already blocks a non-text target; guard the source too (re-typing
		// a file/image/link item would strand its contentType/fileUrl/url).
		if body.ItemTypeName != nil && !textItemTypeNames.has(existing.ItemTypeName) {
			return nil, huma.Error422UnprocessableEntity(
				"Cannot change the type of a " + existing.ItemTypeName + " item.",
			)
		}

		typeID, language, err := s.resolveTypeAndLanguage(ctx, userID, existing, body.ItemTypeName, body.Language)
		if err != nil {
			return nil, err
		}

		row, err := s.Store.UpdateItem(ctx, sqlcdb.UpdateItemParams{
			CollectionIds: body.CollectionIDs,
			Owner:         userID,
			Title:         body.Title,
			Description:   body.Description,
			Content:       body.Content,
			Url:           body.URL,
			Language:      language,
			ItemTypeID:    typeID,
			ID:            in.ID,
			TagIds:        s.tagIDs(body.Tags),
			TagNames:      body.Tags,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, huma.Error404NotFound(itemNotFoundMessage)
			}
			s.Logger.ErrorContext(ctx, "update item failed", "err", err)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		}

		s.Logger.InfoContext(ctx, "item updated", "itemID", in.ID)
		return &updateItemOutput{Body: itemSavedDetails{
			Description: row.Description,
			UpdatedAt:   row.UpdatedAt,
			Collections: decodeCollections(ctx, s, row.Collections),
			URL:         row.Url,
			Tags:        apitypes.DefaultTags(row.Tags),
			IsFavorite:  row.IsFavorite,
			IsPinned:    row.IsPinned,
		}}, nil
	})
}

// resolveTypeAndLanguage picks the final item-type id and language for the update. On a
// retype it resolves the target system type (a missing target → 404, parity with updateItem
// returning null) and remaps the language for that type; otherwise it keeps the item's
// current type id and the normalized client language.
func (s *Service) resolveTypeAndLanguage(
	ctx context.Context,
	userID string,
	existing sqlcdb.GetItemForAuthRow,
	targetTypeName, language *string,
) (string, *string, error) {
	if targetTypeName == nil {
		return existing.ItemTypeId, normalizeOptional(language), nil
	}
	typeID, err := s.Store.GetItemTypeByName(ctx, sqlcdb.GetItemTypeByNameParams{
		Name: *targetTypeName, Owner: &userID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil, huma.Error404NotFound(itemNotFoundMessage)
		}
		s.Logger.ErrorContext(ctx, "update item: resolve target type failed", "err", err)
		return "", nil, huma.Error500InternalServerError(genericErrorMessage)
	}
	return typeID, remapLanguageForType(language, *targetTypeName), nil
}
