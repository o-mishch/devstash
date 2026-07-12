// Package db embeds the goose SQL migrations so the compiled binary is
// self-contained: `api migrate` applies them without shipping loose .sql files
// next to the binary. This matters for the distroless runtime image, which
// contains only the compiled binary and no arbitrary non-Go files.
package db

import "embed"

// Migrations holds every goose migration under migrations/. Wire it into goose
// with goose.SetBaseFS(Migrations) and point goose at the "migrations" dir.
//
//go:embed migrations/*.sql
var Migrations embed.FS
