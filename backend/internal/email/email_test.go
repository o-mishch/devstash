package email

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/o-mishch/devstash/backend/internal/auth"
)

func TestNoopDropsEverything(t *testing.T) {
	t.Parallel()
	n := Noop{}
	ctx := context.Background()
	if err := n.SendVerification(ctx, "a@b.com", "u"); err != nil {
		t.Errorf("SendVerification = %v, want nil", err)
	}
	if err := n.SendPasswordReset(ctx, "a@b.com", "u"); err != nil {
		t.Errorf("SendPasswordReset = %v, want nil", err)
	}
	if err := n.SendSecurityNotification(ctx, "a@b.com", auth.SecurityPasswordReset); err != nil {
		t.Errorf("SendSecurityNotification = %v, want nil", err)
	}
}

func TestSecurityCopy(t *testing.T) {
	t.Parallel()
	events := []auth.SecurityEvent{
		auth.SecurityPasswordReset,
		auth.SecurityCredentialEmailAdded,
		auth.SecurityCredentialEmailChanged,
		auth.SecurityEvent("unknown"),
	}
	for _, e := range events {
		subject, body := securityCopy(e)
		if subject == "" || body == "" {
			t.Errorf("securityCopy(%q) = %q, %q; want non-empty subject and body", e, subject, body)
		}
	}
}

func TestButtonEscapesAndIncludesURL(t *testing.T) {
	t.Parallel()
	html := button("Do it", "Intro <text>", "https://app.test/x?token=a&b=1")
	if !strings.Contains(html, "https://app.test/x?token=a&amp;b=1") {
		t.Errorf("button did not include the escaped url: %s", html)
	}
	if strings.Contains(html, "<text>") {
		t.Error("button did not escape the intro text")
	}
}

func TestParagraph(t *testing.T) {
	t.Parallel()
	if got := paragraph("hello & goodbye"); !strings.Contains(got, "hello &amp; goodbye") {
		t.Errorf("paragraph = %s, want escaped body", got)
	}
}

// newTestClient builds a Client whose Resend base URL points at srv.
func newTestClient(t *testing.T, srv *httptest.Server) *Client {
	t.Helper()
	c := New("test-key", "from@devstash.test")
	base, err := url.Parse(srv.URL + "/")
	if err != nil {
		t.Fatalf("parse base url: %v", err)
	}
	c.resend.BaseURL = base
	return c
}

func TestClientSendsThroughResend(t *testing.T) {
	t.Parallel()
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"email-1"}`))
	}))
	t.Cleanup(srv.Close)

	c := newTestClient(t, srv)
	ctx := context.Background()
	if err := c.SendVerification(ctx, "to@devstash.test", "https://app/verify"); err != nil {
		t.Fatalf("SendVerification = %v, want nil", err)
	}
	if gotPath != "/emails" {
		t.Errorf("request path = %q, want /emails", gotPath)
	}
	if err := c.SendPasswordReset(ctx, "to@devstash.test", "https://app/reset"); err != nil {
		t.Errorf("SendPasswordReset = %v, want nil", err)
	}
	if err := c.SendSecurityNotification(ctx, "to@devstash.test", auth.SecurityPasswordReset); err != nil {
		t.Errorf("SendSecurityNotification = %v, want nil", err)
	}
}

func TestClientSurfacesResendError(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"message":"bad"}`))
	}))
	t.Cleanup(srv.Close)

	c := newTestClient(t, srv)
	if err := c.SendVerification(context.Background(), "to@devstash.test", "https://app/verify"); err == nil {
		t.Fatal("SendVerification error = nil, want the Resend error surfaced")
	}
}
