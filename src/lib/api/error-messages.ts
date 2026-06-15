// Human-readable error messages used in more than one place, centralized so wording can't drift
// between call sites. Two kinds live here: (1) strings shared across BOTH client↔server transports
// — the oRPC layer (`throw new ORPCError(code, { message })`) and the `ApiResponse` envelope
// (Server Actions + exempt routes); (2) strings repeated across multiple oRPC handlers in a domain.
// Bespoke, single-site messages stay inline at their call site. Client-safe (pure strings, no
// server-only).
export const ErrorMessage = {
  // Cross-transport (oRPC + ApiResponse)
  NOT_AUTHENTICATED: 'Not authenticated.',
  FILE_NOT_FOUND: 'File not found.',

  // Repeated across oRPC handlers
  ITEM_NOT_FOUND: 'Item not found.',
  COLLECTION_NOT_FOUND: 'Collection not found.',
  NO_PASSWORD_SET: 'No password set.',
  CANNOT_REMOVE_ONLY_SIGN_IN_METHOD: 'Cannot remove your only sign-in method.',
  INVALID_SUBSCRIPTION_PLAN: 'Invalid subscription plan selected.',
  CHECKOUT_START_FAILED: 'Unable to start checkout. Please try again.',
} as const
