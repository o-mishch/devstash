package items

import (
	"net/url"
	"strings"

	"github.com/danielgtaylor/huma/v2"
)

// normalizeURLField trims *field in place and, when non-empty, requires a valid http(s) URL
// (parity with the itemMutationSchema url union: valid http/https URL, or empty → null). An
// empty value becomes nil; an invalid one is left as-is and a field-level error is returned
// for the resolver to collect. Called from the create/update huma.Resolver.
func normalizeURLField(field **string, loc string) error {
	if *field == nil {
		return nil
	}
	trimmed := strings.TrimSpace(**field)
	if trimmed == "" {
		*field = nil
		return nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return &huma.ErrorDetail{Location: loc, Message: "Must be a valid URL", Value: trimmed}
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return &huma.ErrorDetail{Location: loc, Message: "URL must use http or https", Value: trimmed}
	}
	*field = &trimmed
	return nil
}

// validateDescriptionField normalizes *field in place (trim, empty→null) and enforces the max
// length (parity with description max ITEM_DESCRIPTION_MAX_CHARS). Returns a field-level error
// when too long, for the resolver to collect.
func validateDescriptionField(field **string, loc string) error {
	*field = normalizeOptional(*field)
	if *field != nil && len([]rune(**field)) > itemDescriptionMaxChars {
		return &huma.ErrorDetail{Location: loc, Message: "Description is too long"}
	}
	return nil
}
