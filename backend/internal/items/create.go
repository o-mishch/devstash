package items

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/danielgtaylor/huma/v2"
	"github.com/jackc/pgx/v5"

	"github.com/o-mishch/devstash/backend/internal/apitypes"
	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	"github.com/o-mishch/devstash/backend/internal/middleware"
)

// createItemInput is the POST /items body. Huma's struct tags enforce presence/format; the
// semantic rules that tags can't express (trim-then-min, empty→null coercion, http/https URL,
// per-type presence) run in Resolve, which Huma calls after schema validation and whose errors
// merge into one exhaustive RFC 9457 response. The Pro/limit/file-reference gates need DB
// reads and non-422 statuses, so they stay in the handler.
type createItemInput struct {
	Body struct {
		Title         string   `json:"title"                   minLength:"1" required:"true"`
		Description   *string  `json:"description,omitempty"`
		Content       *string  `json:"content,omitempty"`
		URL           *string  `json:"url,omitempty"`
		Language      *string  `json:"language,omitempty"`
		Tags          []string `json:"tags,omitempty"`
		CollectionIDs []string `json:"collectionIds,omitempty"`
		ItemTypeName  string   `json:"itemTypeName"            minLength:"1" required:"true"`
		FileURL       *string  `json:"fileUrl,omitempty"`
		ImageWidth    *int32   `json:"imageWidth,omitempty"`
		ImageHeight   *int32   `json:"imageHeight,omitempty"`
	}
}

// Resolve normalizes and validates the create body in place (parity with createItemSchema).
func (in *createItemInput) Resolve(_ huma.Context) []error {
	var errs []error
	b := &in.Body

	b.ItemTypeName = strings.TrimSpace(b.ItemTypeName)
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
	b.FileURL = normalizeOptional(b.FileURL)
	b.Tags = normalizeTags(b.Tags)
	if b.CollectionIDs == nil {
		b.CollectionIDs = []string{}
	}

	// Per-type presence rules (createItemSchema refinements).
	if itemTypesWithURL.has(b.ItemTypeName) && b.URL == nil {
		errs = append(errs, &huma.ErrorDetail{Location: "body.url", Message: "URL is required for links"})
	}
	if itemTypesWithFile.has(b.ItemTypeName) && b.FileURL == nil {
		errs = append(
			errs,
			&huma.ErrorDetail{Location: "body.fileUrl", Message: "A file must be uploaded for this type"},
		)
	}
	return errs
}

type createItemOutput struct {
	Body apitypes.LightItem
}

// registerCreate wires POST /items. Body validation/normalization happens in Resolve; the
// handler runs the business gates in parity order: Pro-type → free-tier limit → file-reference
// → insert.
func registerCreate(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID:   "create-item",
		Method:        http.MethodPost,
		Path:          "/items",
		Summary:       "Create an item",
		Tags:          []string{tagItems},
		Security:      secured(),
		DefaultStatus: http.StatusCreated,
	}, func(ctx context.Context, in *createItemInput) (*createItemOutput, error) {
		userID, _ := middleware.CurrentUserID(ctx)
		if err := s.enforceItemMutation(ctx, userID); err != nil {
			return nil, err
		}

		body := in.Body
		isFileType := itemTypesWithFile.has(body.ItemTypeName)

		// Pro-only type gate.
		if proItemTypeNames.has(body.ItemTypeName) && !isPro(ctx) {
			return nil, huma.Error403Forbidden("Upgrade to Pro to upload " + proItemTypeNamesLabel + ".")
		}

		// Free-tier item limit.
		if allowed, lerr := s.canCreateItem(ctx, userID); lerr != nil {
			s.Logger.ErrorContext(ctx, "create item: count failed", "err", lerr)
			return nil, huma.Error500InternalServerError(genericErrorMessage)
		} else if !allowed {
			return nil, huma.Error403Forbidden(
				"You have reached your free tier limit of 50 items. Please upgrade to Pro.",
			)
		}

		// File-reference gate. The Redis pending-upload consume that would validate the
		// reference and resolve fileName/fileSize is the Phase-3 upload flow; until it lands
		// there is no valid reference, so a file/image create is rejected here (the same 403
		// the Next route returns for an invalid reference).
		if isFileType {
			return nil, huma.Error403Forbidden("Invalid file reference.")
		}

		row, err := s.Store.CreateItem(ctx, sqlcdb.CreateItemParams{
			ItemTypeName:  body.ItemTypeName,
			Owner:         &userID,
			ID:            s.IDs(),
			Title:         body.Title,
			ContentType:   contentTypeFor(body.ItemTypeName),
			Description:   body.Description,
			Content:       body.Content,
			Url:           body.URL,
			FileUrl:       nil,
			FileName:      nil,
			FileSize:      nil,
			ImageWidth:    nil,
			ImageHeight:   nil,
			Language:      body.Language,
			TagIds:        s.tagIDs(body.Tags),
			TagNames:      body.Tags,
			CollectionIds: body.CollectionIDs,
		})
		if err != nil {
			// No row means the type name resolved to nothing (unknown type) — parity with a
			// createItem returning null → "Failed to create item."
			if errors.Is(err, pgx.ErrNoRows) {
				s.Logger.WarnContext(ctx, "create item: type not found", "itemTypeName", body.ItemTypeName)
				return nil, huma.Error500InternalServerError("Failed to create item.")
			}
			s.Logger.ErrorContext(ctx, "create item failed", "err", err)
			return nil, huma.Error500InternalServerError("Failed to create item.")
		}

		s.Logger.InfoContext(ctx, "item created", "itemID", row.ID, "itemTypeName", body.ItemTypeName)
		return &createItemOutput{Body: apitypes.NewLightItem(apitypes.LightFields{
			ID: row.ID, Title: row.Title, CreatedAt: row.CreatedAt, URL: row.Url,
			FileName: row.FileName, FileSize: row.FileSize, IsFavorite: row.IsFavorite, IsPinned: row.IsPinned,
			ItemTypeName: row.ItemTypeName, DescriptionPreview: row.DescriptionPreview,
			ContentPreview: row.ContentPreview, Tags: row.Tags,
		})}, nil
	})
}

// canCreateItem enforces the free-tier item cap: Pro users are unlimited, others are capped
// at FREE_TIER_ITEM_LIMIT (parity with usage.ts canCreateItem).
func (s *Service) canCreateItem(ctx context.Context, userID string) (bool, error) {
	if isPro(ctx) {
		return true, nil
	}
	count, err := s.Store.CountItemsByUser(ctx, userID)
	if err != nil {
		return false, err
	}
	return count < freeTierItemLimit, nil
}

// tagIDs mints a fresh id per tag name (used only for genuinely new tags — the connect-or-
// create keeps an existing tag's id). Parallel to the names slice.
func (s *Service) tagIDs(names []string) []string {
	ids := make([]string, len(names))
	for i := range names {
		ids[i] = s.IDs()
	}
	return ids
}
