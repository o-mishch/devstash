package middleware

import "net/http"

// writeProblem writes a pre-rendered RFC 9457 problem+json body with the given status.
// It centralises the write mechanics shared by the net/http middlewares that run OUTSIDE
// Huma's error machinery (Recover's panic 500, CrossOrigin's CSRF 403) and so cannot
// route through huma.WriteErr. The body strings themselves are package constants pinned
// byte-for-byte to Huma's envelope by TestProblemBodiesMatchHuma — this helper only
// removes the duplicated Content-Type/WriteHeader/Write triple, it does not author the
// shape.
func writeProblem(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}
