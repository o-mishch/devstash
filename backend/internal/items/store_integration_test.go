package items

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/o-mishch/devstash/backend/db"
	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
	pgconn "github.com/o-mishch/devstash/backend/internal/postgres"
)

// This file anchors the item write path against the REAL sqlc queries on a throwaway
// Postgres. The handler tests all run against the in-memory fakeItemStore, which records
// params but never executes the multi-CTE CreateItem/UpdateItem SQL — so a divergence
// between the hand-written reconciliation SQL and the shape the handlers assume would leave
// every handler test green while production 500s. It pins the behaviours the fakes cannot:
//   - CreateItem inserts the item, connect-or-creates its tags, and links tags + collections
//   - connect-or-create reuses an existing tag row (ON CONFLICT(name)) rather than duplicating
//   - UpdateItem reconciles to the new set WITHOUT a duplicate-key error when a tag/collection
//     is KEPT (the delete-then-reinsert-in-one-snapshot trap), and removes the dropped ones
//   - UpdateItem clearing all tags/collections empties the join tables

const (
	itgUserID  = "itg-user"
	itgTypeID  = "itg-type-snippet"
	itgCollID  = "itg-coll-1"
	snippetTyp = "snippet"
)

// realItemStore starts a per-test Postgres, applies the embedded goose baseline, seeds the
// prerequisite rows (a user, the system 'snippet' item type, and one owned collection), and
// returns the real sqlc *Queries plus the pool for direct assertion queries. Torn down via
// t.Cleanup.
func realItemStore(t *testing.T) (*sqlcdb.Queries, *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	container, err := postgres.Run(ctx, "postgres:17-alpine",
		postgres.WithDatabase("devstash_test"),
		postgres.WithUsername("test"),
		postgres.WithPassword("test"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		if termErr := testcontainers.TerminateContainer(container); termErr != nil {
			t.Logf("terminate postgres container: %v", termErr)
		}
	})

	dsn, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("connection string: %v", err)
	}

	pool, err := pgconn.Connect(ctx, dsn, discardLogger())
	if err != nil {
		t.Fatalf("connect pool: %v", err)
	}
	t.Cleanup(pool.Close)

	sqlDB := stdlib.OpenDBFromPool(pool)
	goose.SetBaseFS(db.Migrations)
	goose.SetTableName("goose_db_version")
	if err := goose.Up(sqlDB, "migrations"); err != nil {
		t.Fatalf("apply migrations: %v", err)
	}

	seedItemFixtures(ctx, t, pool)
	return sqlcdb.New(pool), pool
}

// seedItemFixtures inserts the rows CreateItem/UpdateItem depend on but that have no sqlc
// query: the owner, the system item type CreateItem resolves by name, and one owned collection.
func seedItemFixtures(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	stmts := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users (id, email, "updatedAt") VALUES ($1, $2, now())`, []any{itgUserID, "itg@example.com"}},
		{
			`INSERT INTO item_types (id, name, icon, color, "isSystem", "userId") VALUES ($1, $2, 'i', 'c', true, NULL)`,
			[]any{itgTypeID, snippetTyp},
		},
		{
			`INSERT INTO collections (id, name, "userId", "updatedAt") VALUES ($1, 'Coll', $2, now())`,
			[]any{itgCollID, itgUserID},
		},
	}
	for stmt := range slices.Values(stmts) {
		if _, err := pool.Exec(ctx, stmt.sql, stmt.args...); err != nil {
			t.Fatalf("seed %q: %v", stmt.sql, err)
		}
	}
}

func TestItemStoreWritesAgainstPostgres(t *testing.T) {
	store, pool := realItemStore(t)
	ctx := t.Context()

	create := func(t *testing.T, id string, tagNames, collectionIDs []string) sqlcdb.CreateItemRow {
		t.Helper()
		owner := itgUserID
		row, err := store.CreateItem(ctx, sqlcdb.CreateItemParams{
			ItemTypeName:  snippetTyp,
			Owner:         &owner,
			ID:            id,
			Title:         "T",
			ContentType:   sqlcdb.ContentTypeTEXT,
			TagIds:        mintTagIDs(tagNames),
			TagNames:      tagNames,
			CollectionIds: collectionIDs,
		})
		if err != nil {
			t.Fatalf("CreateItem(%s): %v", id, err)
		}
		return row
	}

	t.Run("create links tags and collections", func(t *testing.T) {
		row := create(t, "itm-create", []string{"go", "rust"}, []string{itgCollID})
		if got := sortedCopy(row.Tags); !slices.Equal(got, []string{"go", "rust"}) {
			t.Errorf("returned tags = %v, want [go rust]", got)
		}
		if got := itemTagNames(ctx, t, pool, "itm-create"); !slices.Equal(got, []string{"go", "rust"}) {
			t.Errorf("_ItemTags names = %v, want [go rust]", got)
		}
		if got := itemCollectionIDs(ctx, t, pool, "itm-create"); !slices.Equal(got, []string{itgCollID}) {
			t.Errorf("item_collections = %v, want [%s]", got, itgCollID)
		}
	})

	t.Run("connect-or-create reuses an existing tag row", func(t *testing.T) {
		create(t, "itm-share-a", []string{"shared"}, nil)
		create(t, "itm-share-b", []string{"shared"}, nil)
		var n int
		if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM tags WHERE name = 'shared'`).Scan(&n); err != nil {
			t.Fatalf("count shared tag: %v", err)
		}
		if n != 1 {
			t.Errorf("tags named 'shared' = %d, want 1 (connect-or-create must not duplicate)", n)
		}
	})

	// The P4-1 regression: editing an item while KEEPING a tag and a collection previously
	// 500'd because the one-statement delete-then-reinsert collided with the still-live PK row.
	t.Run("update keeping a tag and collection does not 500 and reconciles", func(t *testing.T) {
		create(t, "itm-update", []string{"go", "rust"}, []string{itgCollID})
		row, err := store.UpdateItem(ctx, sqlcdb.UpdateItemParams{
			Owner:         itgUserID,
			ID:            "itm-update",
			Title:         "T2",
			ItemTypeID:    itgTypeID,
			TagIds:        mintTagIDs([]string{"go", "redis"}),
			TagNames:      []string{"go", "redis"}, // "go" kept, "rust" dropped, "redis" added
			CollectionIds: []string{itgCollID},     // collection kept
		})
		if err != nil {
			t.Fatalf("UpdateItem keeping a tag/collection: %v (this is the P4-1 duplicate-key bug)", err)
		}
		if got := sortedCopy(row.Tags); !slices.Equal(got, []string{"go", "redis"}) {
			t.Errorf("returned tags = %v, want [go redis]", got)
		}
		if got := itemTagNames(ctx, t, pool, "itm-update"); !slices.Equal(got, []string{"go", "redis"}) {
			t.Errorf("_ItemTags names = %v, want [go redis] (go kept, rust removed, redis added)", got)
		}
		if got := itemCollectionIDs(ctx, t, pool, "itm-update"); !slices.Equal(got, []string{itgCollID}) {
			t.Errorf("item_collections = %v, want the kept [%s]", got, itgCollID)
		}
	})

	t.Run("update clearing all tags and collections empties the join tables", func(t *testing.T) {
		create(t, "itm-clear", []string{"go"}, []string{itgCollID})
		if _, err := store.UpdateItem(ctx, sqlcdb.UpdateItemParams{
			Owner: itgUserID, ID: "itm-clear", Title: "T3", ItemTypeID: itgTypeID,
			TagIds: []string{}, TagNames: []string{}, CollectionIds: []string{},
		}); err != nil {
			t.Fatalf("UpdateItem clearing links: %v", err)
		}
		if got := itemTagNames(ctx, t, pool, "itm-clear"); len(got) != 0 {
			t.Errorf("_ItemTags names = %v, want empty", got)
		}
		if got := itemCollectionIDs(ctx, t, pool, "itm-clear"); len(got) != 0 {
			t.Errorf("item_collections = %v, want empty", got)
		}
	})
}

// mintTagIDs fabricates a positionally-aligned id per tag name (the handler injects UUIDv7s);
// for an existing name the ON CONFLICT(name) keeps the stored id, so these matter only for
// genuinely-new tags.
func mintTagIDs(names []string) []string {
	ids := make([]string, 0, len(names))
	for name := range slices.Values(names) {
		ids = append(ids, "tid-"+name)
	}
	return ids
}

func sortedCopy(s []string) []string {
	out := slices.Clone(s)
	slices.Sort(out)
	return out
}

func itemTagNames(ctx context.Context, t *testing.T, pool *pgxpool.Pool, itemID string) []string {
	t.Helper()
	rows, err := pool.Query(ctx,
		`SELECT tg.name FROM "_ItemTags" it JOIN tags tg ON tg.id = it."B" WHERE it."A" = $1 ORDER BY tg.name`,
		itemID)
	if err != nil {
		t.Fatalf("query item tags: %v", err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			t.Fatalf("scan tag name: %v", err)
		}
		names = append(names, n)
	}
	return names
}

func itemCollectionIDs(ctx context.Context, t *testing.T, pool *pgxpool.Pool, itemID string) []string {
	t.Helper()
	rows, err := pool.Query(ctx,
		`SELECT "collectionId" FROM item_collections WHERE "itemId" = $1 ORDER BY "collectionId"`, itemID)
	if err != nil {
		t.Fatalf("query item collections: %v", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan collection id: %v", err)
		}
		ids = append(ids, id)
	}
	return ids
}
