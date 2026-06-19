/**
 * Centralized human-readable error messages to prevent wording drift across call sites.
 *
 * Caters to two primary scenarios:
 * 1. Cross-transport strings shared by Route Handlers (`problem()`) and Server Actions (`ActionState`).
 * 2. Repeated strings shared across multiple Route Handlers of a single feature domain.
 *
 * Pure strings only (client-safe, no server-only imports).
 */
export const ErrorMessage = {
  // Cross-transport (route handlers + Server Actions)
  NOT_AUTHENTICATED: 'Not authenticated.',
  FILE_NOT_FOUND: 'File not found.',

  // Repeated across route handlers
  ITEM_NOT_FOUND: 'Item not found.',
  COLLECTION_NOT_FOUND: 'Collection not found.',
  NO_PASSWORD_SET: 'No password set.',
  CANNOT_REMOVE_ONLY_SIGN_IN_METHOD: 'Cannot remove your only sign-in method.',
  INVALID_SUBSCRIPTION_PLAN: 'Invalid subscription plan selected.',
  CHECKOUT_START_FAILED: 'Unable to start checkout. Please try again.',
} as const
