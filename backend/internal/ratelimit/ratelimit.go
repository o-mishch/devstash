// Package ratelimit is the Redis-backed rate limiter for the auth flows. It wraps
// go-redis's official redis_rate (GCRA leaky-bucket) companion and exposes the
// named buckets ported from the Next app's Redis limits. Callers reference a
// bucket by name and a caller-chosen key (IP, IP:email, or userId) — the bucket
// owns the rate, the key owns the subject.
package ratelimit

import (
	"context"
	"fmt"
	"time"

	"github.com/go-redis/redis_rate/v10"
	"github.com/redis/go-redis/v9"
)

// Bucket names — the exact set from the Next app's rate-limit config. Kept as typed
// constants so handlers can't typo a bucket into a silently-unlimited path.
const (
	BucketLogin                = "login"                // 5 / 15m  (ip:email)
	BucketLoginIP              = "loginIP"              // 20 / 1m  (ip) pre-bcrypt guard
	BucketLoginAuthorizeIP     = "loginAuthorizeIP"     // 20 / 1m  (ip) authorize() guard
	BucketRegister             = "register"             // 3 / 1h   (ip)
	BucketForgotPassword       = "forgotPassword"       // 3 / 1h   (ip)
	BucketResetPassword        = "resetPassword"        // 5 / 15m  (ip)
	BucketVerifyEmail          = "verifyEmail"          // 5 / 15m  (ip)
	BucketResendVerification   = "resendVerification"   // 3 / 15m  (ip:email)
	BucketResendVerificationIP = "resendVerificationIP" // 10 / 15m (ip) pre-parse guard
	BucketLinkAccount          = "linkAccount"          // 5 / 15m  (ip)
	BucketConfirmLoginEmail    = "confirmLoginEmail"    // 5 / 15m  (ip)
	BucketCredentialEmail      = "credentialEmail"      // #nosec G101 // 5 / 15m (userId)
	BucketItemMutation         = "itemMutation"         // 120 / 1h (userId) — item create/update/delete/favorite/pinned
)

// limits maps each bucket to its GCRA limit. Rate+Burst equal to the window count
// gives "N attempts per period" semantics matching the Next app's fixed windows.
var limits = map[string]redis_rate.Limit{
	BucketLogin:                {Rate: 5, Burst: 5, Period: 15 * time.Minute},
	BucketLoginIP:              {Rate: 20, Burst: 20, Period: time.Minute},
	BucketLoginAuthorizeIP:     {Rate: 20, Burst: 20, Period: time.Minute},
	BucketRegister:             {Rate: 3, Burst: 3, Period: time.Hour},
	BucketForgotPassword:       {Rate: 3, Burst: 3, Period: time.Hour},
	BucketResetPassword:        {Rate: 5, Burst: 5, Period: 15 * time.Minute},
	BucketVerifyEmail:          {Rate: 5, Burst: 5, Period: 15 * time.Minute},
	BucketResendVerification:   {Rate: 3, Burst: 3, Period: 15 * time.Minute},
	BucketResendVerificationIP: {Rate: 10, Burst: 10, Period: 15 * time.Minute},
	BucketLinkAccount:          {Rate: 5, Burst: 5, Period: 15 * time.Minute},
	BucketConfirmLoginEmail:    {Rate: 5, Burst: 5, Period: 15 * time.Minute},
	BucketCredentialEmail:      {Rate: 5, Burst: 5, Period: 15 * time.Minute},
	BucketItemMutation:         {Rate: 120, Burst: 120, Period: time.Hour},
}

// Decision is the outcome of a rate-limit check. RetryAfter is the wait until the
// next attempt would be allowed (zero when Allowed).
type Decision struct {
	Allowed    bool
	RetryAfter time.Duration
}

// Limiter is the narrow interface the auth package consumes. The real Redis limiter
// and the in-memory test fake both satisfy it.
type Limiter interface {
	Allow(ctx context.Context, bucket, key string) (Decision, error)
}

// RedisLimiter is the production Limiter backed by redis_rate over go-redis.
type RedisLimiter struct {
	rl *redis_rate.Limiter
}

// New builds a RedisLimiter on the shared go-redis client.
func New(client *redis.Client) *RedisLimiter {
	return &RedisLimiter{rl: redis_rate.NewLimiter(client)}
}

// Allow consumes one token from the named bucket for key. An unknown bucket is a
// programming error (fail closed rather than silently allow).
func (l *RedisLimiter) Allow(ctx context.Context, bucket, key string) (Decision, error) {
	limit, ok := limits[bucket]
	if !ok {
		return Decision{}, fmt.Errorf("ratelimit: unknown bucket %q", bucket)
	}
	res, err := l.rl.Allow(ctx, bucket+":"+key, limit)
	if err != nil {
		return Decision{}, fmt.Errorf("ratelimit: allow %s: %w", bucket, err)
	}
	allowed := res.Allowed > 0
	var retryAfter time.Duration
	if !allowed {
		retryAfter = res.RetryAfter
	}
	return Decision{Allowed: allowed, RetryAfter: retryAfter}, nil
}
