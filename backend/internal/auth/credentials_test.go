package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	sqlcdb "github.com/o-mishch/devstash/backend/internal/db"
)

func TestValidateCredential(t *testing.T) {
	t.Parallel()

	const password = "correct-horse"
	hash := hashPassword(t, password)
	now := time.Unix(1_700_000_000, 0)

	verified := sqlcdb.User{
		ID:            "u1",
		Email:         "verified@example.com",
		Password:      new(hash),
		EmailVerified: new(now),
	}
	unverified := sqlcdb.User{ID: "u2", Email: "unverified@example.com", Password: new(hash)}
	oauthOnly := sqlcdb.User{ID: "u3", Email: "oauth@example.com"} // no password
	credUser := sqlcdb.User{
		ID: "u4", Email: "primary@example.com", Password: new(hash),
		CredentialEmail: new("cred@example.com"), CredentialEmailVerified: new(now),
	}

	store := newFakeUserStore()
	for _, u := range []sqlcdb.User{verified, unverified, oauthOnly, credUser} {
		store.add(u)
	}
	d := New(Deps{Users: store})

	tests := []struct {
		name         string
		email        string
		password     string
		wantOK       bool
		wantVerified bool
		wantUserID   string
	}{
		{
			name:         "correct verified primary",
			email:        "verified@example.com",
			password:     password,
			wantOK:       true,
			wantVerified: true,
			wantUserID:   "u1",
		},
		{
			name:         "correct unverified primary",
			email:        "unverified@example.com",
			password:     password,
			wantOK:       true,
			wantVerified: false,
			wantUserID:   "u2",
		},
		{
			name:         "correct verified credential email",
			email:        "cred@example.com",
			password:     password,
			wantOK:       true,
			wantVerified: true,
			wantUserID:   "u4",
		},
		{name: "wrong password", email: "verified@example.com", password: "nope", wantOK: false},
		{name: "unknown user", email: "ghost@example.com", password: password, wantOK: false},
		{name: "oauth-only account has no password", email: "oauth@example.com", password: password, wantOK: false},
		{
			// bcrypt's CompareHashAndPassword does not reject on length — it truncates to
			// 72 bytes and compares. So a long password that differs from the stored one is
			// simply a wrong-password miss, not a length-guard rejection.
			name:     "long wrong password is a miss (bcrypt truncates at 72)",
			email:    "verified@example.com",
			password: strings.Repeat("x", 129),
			wantOK:   false,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			match, ok, err := d.validateCredential(context.Background(), tc.email, tc.password)
			if err != nil {
				t.Fatalf("validateCredential() unexpected error = %v", err)
			}
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if !ok {
				return
			}
			if match.user.ID != tc.wantUserID {
				t.Errorf("user.ID = %q, want %q", match.user.ID, tc.wantUserID)
			}
			if match.matchedVerified != tc.wantVerified {
				t.Errorf("matchedVerified = %v, want %v", match.matchedVerified, tc.wantVerified)
			}
		})
	}
}

func TestValidateCredentialSurfacesDBError(t *testing.T) {
	t.Parallel()
	store := newFakeUserStore()
	store.emailErr = errors.New("connection refused")
	d := New(Deps{Users: store})

	if _, _, err := d.validateCredential(context.Background(), "x@example.com", "pw"); err == nil {
		t.Fatal("validateCredential() error = nil, want the DB error surfaced")
	}
}
