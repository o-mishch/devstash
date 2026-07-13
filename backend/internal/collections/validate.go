package collections

import (
	"strings"

	"github.com/danielgtaylor/huma/v2"
)

// validateName trims *name in place and enforces presence + max length (parity with
// collectionFormSchema name: trim, min 1, max 100). Returns a field-level error for the
// resolver to collect.
func validateName(name *string, loc string) error {
	*name = strings.TrimSpace(*name)
	switch {
	case *name == "":
		return &huma.ErrorDetail{Location: loc, Message: "Name is required"}
	case len([]rune(*name)) > collectionNameMaxChars:
		return &huma.ErrorDetail{Location: loc, Message: "Name is too long"}
	default:
		return nil
	}
}

// normalizeDescription trims *field in place, coerces empty to null, and enforces the max
// length (parity with collectionFormSchema description: trim, max 500, ”→null). Returns a
// field-level error when too long.
func normalizeDescription(field **string, loc string) error {
	if *field == nil {
		return nil
	}
	trimmed := strings.TrimSpace(**field)
	if trimmed == "" {
		*field = nil
		return nil
	}
	if len([]rune(trimmed)) > collectionDescMaxChars {
		return &huma.ErrorDetail{Location: loc, Message: "Description is too long"}
	}
	*field = &trimmed
	return nil
}
