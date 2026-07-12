package session

import (
	"strings"
	"testing"
	"time"
)

func TestPasswordFingerprint(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		hash string
		want string
	}{
		{name: "empty", hash: "", want: ""},
		{name: "shorter than 8 returns whole", hash: "abc", want: "abc"},
		{name: "exactly 8 returns whole", hash: "abcdefgh", want: "abcdefgh"},
		{name: "bcrypt hash returns last 8", hash: "$2b$12$" + strings.Repeat("a", 45) + "TAILTAIL", want: "TAILTAIL"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := PasswordFingerprint(tc.hash); got != tc.want {
				t.Errorf("PasswordFingerprint(%q) = %q, want %q", tc.hash, got, tc.want)
			}
		})
	}
}

func TestClassifyFingerprint(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		prev string
		next string
		want FingerprintChange
	}{
		{name: "identical", prev: "aaaaaaaa", next: "aaaaaaaa", want: FingerprintUnchanged},
		{name: "both empty", prev: "", next: "", want: FingerprintUnchanged},
		{name: "password rotated", prev: "aaaaaaaa", next: "bbbbbbbb", want: FingerprintInvalidate},
		{name: "password added", prev: "", next: "bbbbbbbb", want: FingerprintSync},
		{name: "password removed", prev: "aaaaaaaa", next: "", want: FingerprintSync},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := ClassifyFingerprint(tc.prev, tc.next); got != tc.want {
				t.Errorf("ClassifyFingerprint(%q, %q) = %v, want %v", tc.prev, tc.next, got, tc.want)
			}
		})
	}
}

func TestShouldPersistActivity(t *testing.T) {
	t.Parallel()
	now := time.Unix(1_700_000_000, 0)
	tests := []struct {
		name       string
		lastActive time.Time
		want       bool
	}{
		{name: "zero always persists", lastActive: time.Time{}, want: true},
		{name: "within update window skips", lastActive: now.Add(-30 * time.Second), want: false},
		{name: "at update window persists", lastActive: now.Add(-UpdateAge), want: true},
		{name: "past update window persists", lastActive: now.Add(-2 * time.Minute), want: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := ShouldPersistActivity(tc.lastActive, now); got != tc.want {
				t.Errorf("ShouldPersistActivity(%v, now) = %v, want %v", tc.lastActive, got, tc.want)
			}
		})
	}
}
