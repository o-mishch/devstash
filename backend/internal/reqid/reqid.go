// Package reqid carries a per-request correlation id on the context. It is a neutral
// leaf shared by the RequestID middleware (which mints and sets the id) and the logging
// handler (which reads it onto every log line), so neither of those packages has to
// depend on the other just to agree on the context key.
package reqid

import "context"

// ctxKey is a private type so the value can only be set/read through With/From — no
// other package can collide on the key.
type ctxKey struct{}

// With returns a copy of ctx carrying id as the request correlation id.
func With(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

// From returns the correlation id stashed on ctx, or "" if none is set.
func From(ctx context.Context) string {
	id, _ := ctx.Value(ctxKey{}).(string)
	return id
}
