-- Add a separate credential-login email, distinct from the OAuth identity `email` (never mutated).
-- Verified independently via a confirmation link; participates in login resolution only once verified.
ALTER TABLE "users" ADD COLUMN "credentialEmail" TEXT;
ALTER TABLE "users" ADD COLUMN "credentialEmailVerified" TIMESTAMP(3);

-- Unique so two accounts can't share a credential-login email. Does NOT prevent collision with
-- another user's `email`; the confirm endpoint guards that case transactionally (P2002 -> 409).
CREATE UNIQUE INDEX "users_credentialEmail_key" ON "users"("credentialEmail");

-- Mark verification_tokens as DEPRECATED: all auth tokens (email verification, password reset, and
-- the credential-login email confirmation) were migrated to Redis (src/lib/auth/tokens.ts). The
-- table is retained only to satisfy the NextAuth PrismaAdapter contract and is no longer read or
-- written by application code; any access is logged as a warning by the Prisma client extension in
-- src/lib/infra/prisma.ts.
COMMENT ON TABLE "verification_tokens" IS 'DEPRECATED: auth tokens migrated to Redis (src/lib/auth/tokens.ts); retained only for the NextAuth PrismaAdapter contract. Do not use.';
