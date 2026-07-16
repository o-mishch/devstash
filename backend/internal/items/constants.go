package items

import (
	"slices"
	"strings"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
)

// Item-domain constants ported from src/lib/utils/constants.ts. Kept as Go consts/sets so
// the handlers reference the same values the Next app enforced.
const (
	// itemsPageSize is ITEMS_PAGE_SIZE — the keyset page size.
	itemsPageSize = 20
	// itemDescriptionMaxChars is ITEM_DESCRIPTION_MAX_CHARS — the description upper bound.
	itemDescriptionMaxChars = 2000
	// freeTierItemLimit is FREE_TIER_ITEM_LIMIT — the free-plan item cap.
	// Mirrored in web/src/components/billing/pricing-feature-lists.tsx — keep in sync.
	freeTierItemLimit = 50
)

// set is a tiny string-set helper (membership only).
type set map[string]struct{}

func (s set) has(v string) bool {
	_, ok := s[v]
	return ok
}

func newSet(vs ...string) set {
	s := make(set, len(vs))
	for v := range slices.Values(vs) {
		s[v] = struct{}{}
	}
	return s
}

var (
	// textItemTypeNames is TEXT_ITEM_TYPE_NAMES — the four types a committed item may be
	// re-typed among (the PATCH source-type guard).
	textItemTypeNames = newSet("snippet", "prompt", "command", "note")
	// proItemTypeNames is PRO_ITEM_TYPE_NAMES — the Pro-only upload types.
	proItemTypeNames = newSet("file", "image")
	// itemTypesWithURL is ITEM_TYPES_WITH_URL.
	itemTypesWithURL = newSet("link")
	// itemTypesWithFile is ITEM_TYPES_WITH_FILE.
	itemTypesWithFile = newSet("file", "image")
	// itemTypesWithLanguage is ITEM_TYPES_WITH_LANGUAGE — the types that keep a language.
	itemTypesWithLanguage = newSet("snippet", "command")
	// commandLanguages is COMMAND_LANGUAGES — the curated shell/CLI set.
	commandLanguages = newSet("bash", "sh", "shell", "zsh", "fish", "powershell", "bat", "dockerfile", "makefile")
	// shellSynonymsToBash is SHELL_SYNONYMS_TO_BASH — generic synonyms that normalize to bash.
	shellSynonymsToBash = newSet("shell", "shellscript", "console", "terminal", "sh", "zsh")
)

// proItemTypeNamesLabel is PRO_ITEM_TYPE_NAMES_LABEL — "file and image".
const proItemTypeNamesLabel = "file and image"

// contentTypeFor derives the item's contentType from its type name (parity with createItem:
// link → URL, file/image → FILE, everything else → TEXT).
func contentTypeFor(itemTypeName string) sqlcdb.ContentType {
	switch {
	case itemTypesWithURL.has(itemTypeName):
		return sqlcdb.ContentTypeURL
	case itemTypesWithFile.has(itemTypeName):
		return sqlcdb.ContentTypeFILE
	default:
		return sqlcdb.ContentTypeTEXT
	}
}

// isShellLanguage mirrors constants.ts isShellLanguage: the curated command set plus the
// generic shell synonyms.
func isShellLanguage(language string) bool {
	lang := strings.ToLower(language)
	return commandLanguages.has(lang) || shellSynonymsToBash.has(lang)
}

// remapLanguageForType is the Go port of remapLanguageForType: best-effort language remap
// when an item is re-typed. Returns the language to keep for targetType, or nil to clear it.
func remapLanguageForType(language *string, targetType string) *string {
	var trimmed string
	if language != nil {
		trimmed = strings.TrimSpace(*language)
	}
	if trimmed == "" {
		return nil
	}
	if !itemTypesWithLanguage.has(targetType) {
		return nil
	}
	lang := strings.ToLower(trimmed)
	if targetType == "command" {
		switch {
		case shellSynonymsToBash.has(lang):
			bash := "bash"
			return &bash
		case commandLanguages.has(lang):
			return &lang
		default:
			return nil
		}
	}
	// targetType == "snippet": a shell language is not a valid snippet language → clear.
	// A kept language preserves the user's casing (the trimmed original, not the lowercased).
	if isShellLanguage(lang) {
		return nil
	}
	return &trimmed
}
