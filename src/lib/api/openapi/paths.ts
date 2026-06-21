import { z } from 'zod'
import type { ZodOpenApiPathsObject, ZodOpenApiResponseObject } from 'zod-openapi'
import {
  createCollectionInput,
  updateCollectionInput,
  collectionSchema,
} from '../schemas/collections'
import {
  createItemInput,
  updateItemInput,
  itemsQueryParam,
  togglePinnedInput,
  lightItemSchema,
  fullItemSchema,
  itemsPageSchema,
  itemDetailsSchema,
  itemSavedDetailsSchema,
  itemContentSchema,
} from '../schemas/items'
import {
  optionalPasswordInput,
  updateNameInput,
  editorPreferencesInput,
  changePasswordInput,
  updateMainEmailInput,
  accountIdParam,
  requestCredentialEmailInput,
} from '../schemas/profile'
import {
  generateDescriptionInput,
  generateTagsInput,
  generateCollectionDescriptionInput,
  explainCodeInput,
  optimizePromptInput,
  aiDescriptionOutput,
  aiExplanationOutput,
  aiOptimizedPromptOutput,
  aiTagsOutput,
  aiUsageOutput,
  brainDumpInput,
  brainDumpJobCreatedSchema,
  brainDumpJobSnapshotSchema,
  brainDumpJobCollectionsInput,
  brainDumpItemPatchInput,
  brainDumpDraftItemSchema,
  brainDumpCommitOutput,
  brainDumpJobListSchema,
  brainDumpSourceListSchema,
  brainDumpJobIdParam,
  brainDumpItemParams,
} from '../schemas/ai'
import { searchQueryParam, searchResultSchema } from '../schemas/search'
import { getUploadUrlInput, deleteUploadQuery, uploadUrlResultSchema } from '../schemas/upload'
import { createCheckoutInput, billingRedirectSchema } from '../schemas/billing'
import {
  loginInput,
  registerInput,
  forgotPasswordInput,
  resetPasswordInput,
  resendVerificationInput,
  confirmLoginEmailInput,
  authRedirectSchema,
  loginEmailNotVerifiedSchema,
  authCallbackProviderParam,
  authCallbackQueryParam,
} from '../schemas/auth'
import { downloadQueryParam, signedDownloadUrlSchema } from '../schemas/download'
import { problemSchema, idParam, toggleFavoriteInput } from '../schemas/common'

// Declares each `method + path → { request schema, response schema, status }` referencing the SAME
// Zod schemas the route handlers import — so the generated OpenAPI doc and the handlers can't
// disagree on shape. [C]. `npm run openapi:gen` turns this into openapi.json + src/types/openapi.ts;
// the drift guard in openapi/spec.test.ts fails if a schema/path changed but openapi.json wasn't
// regenerated. Domains are added here as they migrate.

// Error responses share the `Problem` body so the generated client types `error` as `{ message }`.
const problem = (description: string): ZodOpenApiResponseObject => ({
  description,
  content: { 'application/json': { schema: problemSchema } },
})

// Every authed operation can return 401; declared once here for reuse.
const unauthorized = problem('Not authenticated')

// Rate-limited mutations can return 429; declared once for reuse.
const rateLimited = problem('Rate limit exceeded')

export const paths: ZodOpenApiPathsObject = {
  '/collections': {
    get: {
      summary: 'List the current user\'s collections',
      responses: {
        200: {
          description: 'All collections for the user',
          content: { 'application/json': { schema: z.array(collectionSchema) } },
        },
        401: unauthorized,
      },
    },
    post: {
      summary: 'Create a collection',
      requestBody: { content: { 'application/json': { schema: createCollectionInput } } },
      responses: {
        201: {
          description: 'The created collection',
          content: { 'application/json': { schema: collectionSchema } },
        },
        401: unauthorized,
        403: problem('Free-tier collection limit reached'),
        422: problem('Validation failed'),
      },
    },
  },
  '/collections/{id}': {
    patch: {
      summary: 'Update a collection',
      requestParams: { path: idParam },
      requestBody: { content: { 'application/json': { schema: updateCollectionInput } } },
      responses: {
        200: {
          description: 'The updated collection',
          content: { 'application/json': { schema: collectionSchema } },
        },
        401: unauthorized,
        404: problem('Collection not found'),
        422: problem('Validation failed'),
      },
    },
    delete: {
      summary: 'Delete a collection',
      requestParams: { path: idParam },
      responses: {
        204: { description: 'Collection deleted' },
        401: unauthorized,
        404: problem('Collection not found'),
      },
    },
  },
  '/collections/{id}/favorite': {
    patch: {
      summary: 'Toggle a collection\'s favorite flag',
      requestParams: { path: idParam },
      requestBody: { content: { 'application/json': { schema: toggleFavoriteInput } } },
      responses: {
        204: { description: 'Favorite toggled' },
        401: unauthorized,
        404: problem('Collection not found'),
        422: problem('Validation failed'),
      },
    },
  },
  '/items': {
    get: {
      summary: 'List the current user\'s items (keyset paginated)',
      requestParams: { query: itemsQueryParam },
      responses: {
        200: {
          description: 'A page of items',
          content: { 'application/json': { schema: itemsPageSchema } },
        },
        401: unauthorized,
        422: problem('Invalid query'),
      },
    },
    post: {
      summary: 'Create an item',
      requestBody: { content: { 'application/json': { schema: createItemInput } } },
      responses: {
        201: {
          description: 'The created item',
          content: { 'application/json': { schema: lightItemSchema } },
        },
        401: unauthorized,
        403: problem('Pro-only type or free-tier item limit reached'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/items/{id}': {
    get: {
      summary: 'Get a single item (powers the source deep-link drawer)',
      requestParams: { path: idParam },
      responses: {
        200: {
          description: 'The item',
          content: { 'application/json': { schema: fullItemSchema } },
        },
        401: unauthorized,
        404: problem('Item not found'),
      },
    },
    patch: {
      summary: 'Update an item',
      requestParams: { path: idParam },
      requestBody: { content: { 'application/json': { schema: updateItemInput } } },
      responses: {
        200: {
          description: 'The saved item details',
          content: { 'application/json': { schema: itemSavedDetailsSchema } },
        },
        401: unauthorized,
        403: problem('Pro-only type'),
        404: problem('Item not found'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
    delete: {
      summary: 'Delete an item',
      requestParams: { path: idParam },
      responses: {
        204: { description: 'Item deleted' },
        401: unauthorized,
        404: problem('Item not found'),
        429: rateLimited,
      },
    },
  },
  '/items/{id}/details': {
    get: {
      summary: 'Get an item\'s details (fetched on drawer open)',
      requestParams: { path: idParam },
      responses: {
        200: {
          description: 'The item details',
          content: { 'application/json': { schema: itemDetailsSchema } },
        },
        401: unauthorized,
        404: problem('Item not found'),
      },
    },
  },
  '/items/{id}/content': {
    get: {
      summary: 'Get an item\'s content (content-bearing types)',
      requestParams: { path: idParam },
      responses: {
        200: {
          description: 'The item content',
          content: { 'application/json': { schema: itemContentSchema } },
        },
        401: unauthorized,
        404: problem('Item not found'),
      },
    },
  },
  '/items/{id}/favorite': {
    patch: {
      summary: 'Toggle an item\'s favorite flag',
      requestParams: { path: idParam },
      requestBody: { content: { 'application/json': { schema: toggleFavoriteInput } } },
      responses: {
        204: { description: 'Favorite toggled' },
        401: unauthorized,
        404: problem('Item not found'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/items/{id}/pinned': {
    patch: {
      summary: 'Toggle an item\'s pinned flag',
      requestParams: { path: idParam },
      requestBody: { content: { 'application/json': { schema: togglePinnedInput } } },
      responses: {
        204: { description: 'Pinned toggled' },
        401: unauthorized,
        404: problem('Item not found'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/profile': {
    delete: {
      summary: 'Delete the current user\'s account',
      requestBody: { content: { 'application/json': { schema: optionalPasswordInput } } },
      responses: {
        204: { description: 'Account deleted' },
        400: problem('Password required or incorrect'),
        401: unauthorized,
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/profile/name': {
    patch: {
      summary: 'Update the display name',
      requestBody: { content: { 'application/json': { schema: updateNameInput } } },
      responses: {
        204: { description: 'Name updated' },
        401: unauthorized,
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/profile/editor-preferences': {
    patch: {
      summary: 'Update editor preferences',
      requestBody: { content: { 'application/json': { schema: editorPreferencesInput } } },
      responses: {
        204: { description: 'Preferences updated' },
        401: unauthorized,
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/profile/password': {
    patch: {
      summary: 'Change the password',
      requestBody: { content: { 'application/json': { schema: changePasswordInput } } },
      responses: {
        204: { description: 'Password changed' },
        400: problem('Current password incorrect or not set'),
        401: unauthorized,
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/profile/credentials': {
    delete: {
      summary: 'Remove email & password sign-in',
      requestBody: { content: { 'application/json': { schema: optionalPasswordInput } } },
      responses: {
        204: { description: 'Credentials removed' },
        400: problem('No password set, only sign-in method, or password incorrect'),
        401: unauthorized,
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/profile/main-email': {
    patch: {
      summary: 'Change the main (display/sign-in) email',
      requestBody: { content: { 'application/json': { schema: updateMainEmailInput } } },
      responses: {
        204: { description: 'Main email updated' },
        400: problem('Password required or incorrect'),
        401: unauthorized,
        403: problem('Email not owned by the user'),
        409: problem('Email already in use'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/profile/credential-email': {
    post: {
      summary: 'Request a separate credential-login email (sends a confirmation link, or activates instantly when email verification is disabled)',
      requestBody: { content: { 'application/json': { schema: requestCredentialEmailInput } } },
      responses: {
        204: { description: 'Confirmation link sent (enumeration-safe), or the login activated instantly when verification is disabled' },
        400: problem('Current password required or incorrect (change path re-auth)'),
        401: unauthorized,
        409: problem('That email is already in use (instant-activation path only)'),
        422: problem('Validation failed'),
        429: rateLimited,
        503: problem('Could not send the confirmation email'),
      },
    },
  },
  '/profile/accounts/{id}': {
    delete: {
      summary: 'Unlink an OAuth provider account',
      requestParams: { path: accountIdParam },
      responses: {
        204: { description: 'Account unlinked' },
        400: problem('Cannot remove the only sign-in method'),
        401: unauthorized,
        404: problem('Account not found'),
        429: rateLimited,
      },
    },
  },
  '/ai/description': {
    post: {
      summary: 'Generate an AI item description (Pro)',
      requestBody: { content: { 'application/json': { schema: generateDescriptionInput } } },
      responses: {
        200: {
          description: 'The generated description',
          content: { 'application/json': { schema: aiDescriptionOutput } },
        },
        401: unauthorized,
        403: problem('Pro subscription required'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/ai/explain': {
    post: {
      summary: 'Explain a code item with AI (Pro)',
      requestBody: { content: { 'application/json': { schema: explainCodeInput } } },
      responses: {
        200: {
          description: 'The generated explanation',
          content: { 'application/json': { schema: aiExplanationOutput } },
        },
        401: unauthorized,
        403: problem('Pro subscription required'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/ai/optimize': {
    post: {
      summary: 'Optimize a prompt item with AI (Pro)',
      requestBody: { content: { 'application/json': { schema: optimizePromptInput } } },
      responses: {
        200: {
          description: 'The optimized prompt',
          content: { 'application/json': { schema: aiOptimizedPromptOutput } },
        },
        401: unauthorized,
        403: problem('Pro subscription required'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/ai/tags': {
    post: {
      summary: 'Generate AI tag suggestions (Pro)',
      requestBody: { content: { 'application/json': { schema: generateTagsInput } } },
      responses: {
        200: {
          description: 'The suggested tags',
          content: { 'application/json': { schema: aiTagsOutput } },
        },
        401: unauthorized,
        403: problem('Pro subscription required'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/ai/usage': {
    get: {
      summary: 'Read the current user\'s remaining AI budget per feature (Pro, non-consuming)',
      responses: {
        200: {
          description: 'Remaining AI budget for each feature bucket',
          content: { 'application/json': { schema: aiUsageOutput } },
        },
        401: unauthorized,
        403: problem('Pro subscription required'),
      },
    },
  },
  '/ai/collection-description': {
    post: {
      summary: 'Generate an AI collection description (Pro)',
      requestBody: { content: { 'application/json': { schema: generateCollectionDescriptionInput } } },
      responses: {
        200: {
          description: 'The generated description',
          content: { 'application/json': { schema: aiDescriptionOutput } },
        },
        401: unauthorized,
        403: problem('Pro subscription required'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/ai/brain-dump': {
    get: {
      summary: 'List the current user\'s in-progress brain dump jobs',
      responses: {
        200: {
          description: 'In-progress parse jobs',
          content: { 'application/json': { schema: brainDumpJobListSchema } },
        },
        401: unauthorized,
      },
    },
    post: {
      summary: 'Start a Brain Dump parse job — Pro, 1/hour',
      requestBody: { content: { 'application/json': { schema: brainDumpInput } } },
      responses: {
        201: {
          description: 'The created parse job',
          content: { 'application/json': { schema: brainDumpJobCreatedSchema } },
        },
        401: unauthorized,
        403: problem('Pro subscription required'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/ai/brain-dump/sources': {
    get: {
      summary: 'List eligible text file items for the "Select from my files" picker',
      responses: {
        200: {
          description: 'Eligible source file items',
          content: { 'application/json': { schema: brainDumpSourceListSchema } },
        },
        401: unauthorized,
        403: problem('Pro subscription required'),
      },
    },
  },
  '/ai/brain-dump/{jobId}': {
    get: {
      summary: 'Snapshot of a brain dump job (status, progress, drafts) — resume/poll',
      requestParams: { path: brainDumpJobIdParam },
      responses: {
        200: {
          description: 'The job snapshot',
          content: { 'application/json': { schema: brainDumpJobSnapshotSchema } },
        },
        401: unauthorized,
        404: problem('Parse job not found'),
      },
    },
    patch: {
      summary: 'Set the commit-time collection target (new-collection name + existing ids)',
      requestParams: { path: brainDumpJobIdParam },
      requestBody: { content: { 'application/json': { schema: brainDumpJobCollectionsInput } } },
      responses: {
        204: { description: 'Collection target updated' },
        401: unauthorized,
        404: problem('Parse job not found'),
        422: problem('Validation failed'),
      },
    },
    delete: {
      summary: 'Discard a brain dump job (delete drafts + sourceText; keep the source item; cancel run if processing)',
      requestParams: { path: brainDumpJobIdParam },
      responses: {
        204: { description: 'Job discarded' },
        401: unauthorized,
        404: problem('Parse job not found'),
      },
    },
  },
  '/ai/brain-dump/{jobId}/stream': {
    get: {
      summary: 'SSE stream of a brain dump job — snapshot replay then live drafts',
      requestParams: { path: brainDumpJobIdParam },
      responses: {
        200: {
          description: 'Server-sent events: snapshot, item, progress, done, error',
          content: { 'text/event-stream': { schema: z.string() } },
        },
        401: unauthorized,
        403: problem('Pro subscription required'),
        404: problem('Parse job not found'),
      },
    },
  },
  '/ai/brain-dump/{jobId}/items/{itemId}': {
    patch: {
      summary: 'Edit or reclassify a draft item (drag → bucket)',
      requestParams: { path: brainDumpItemParams },
      requestBody: { content: { 'application/json': { schema: brainDumpItemPatchInput } } },
      responses: {
        200: {
          description: 'The updated draft item',
          content: { 'application/json': { schema: brainDumpDraftItemSchema } },
        },
        401: unauthorized,
        404: problem('Draft item not found'),
        422: problem('Validation failed'),
      },
    },
    delete: {
      summary: 'Discard a draft item',
      requestParams: { path: brainDumpItemParams },
      responses: {
        204: { description: 'Draft item deleted' },
        401: unauthorized,
        404: problem('Draft item not found'),
      },
    },
  },
  '/ai/brain-dump/{jobId}/items/{itemId}/commit': {
    post: {
      summary: 'Commit a single draft into a real item (Save now)',
      requestParams: { path: brainDumpItemParams },
      responses: {
        200: {
          description: 'Number of items created (1, or 0 when the create failed)',
          content: { 'application/json': { schema: brainDumpCommitOutput } },
        },
        401: unauthorized,
        403: problem('Pro subscription required'),
        404: problem('Draft item not found'),
      },
    },
  },
  '/ai/brain-dump/{jobId}/trash': {
    delete: {
      summary: 'Empty the trash — permanently delete all trashed drafts of a job',
      requestParams: { path: brainDumpJobIdParam },
      responses: {
        204: { description: 'Trashed drafts deleted' },
        401: unauthorized,
        404: problem('Parse job not found'),
      },
    },
  },
  '/ai/brain-dump/{jobId}/commit': {
    post: {
      summary: 'Commit all drafts into real items and delete the job',
      requestParams: { path: brainDumpJobIdParam },
      responses: {
        200: {
          description: 'Number of items created',
          content: { 'application/json': { schema: brainDumpCommitOutput } },
        },
        401: unauthorized,
        403: problem('Pro subscription required'),
        404: problem('Parse job not found'),
        409: problem('Wait for parsing to finish before saving all items'),
      },
    },
  },
  '/search': {
    get: {
      summary: 'Global fuzzy search across the user\'s items and collections',
      requestParams: { query: searchQueryParam },
      responses: {
        200: {
          description: 'Matching items and collections',
          content: { 'application/json': { schema: searchResultSchema } },
        },
        401: unauthorized,
        422: problem('Validation failed'),
      },
    },
  },
  '/upload/url': {
    post: {
      summary: 'Issue a presigned S3 upload credential (Pro)',
      requestBody: { content: { 'application/json': { schema: getUploadUrlInput } } },
      responses: {
        200: {
          description: 'Presigned POST credentials for the original (and optional thumbnail)',
          content: { 'application/json': { schema: uploadUrlResultSchema } },
        },
        400: problem('Disallowed extension or file too large'),
        401: unauthorized,
        403: problem('Pro subscription required'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/upload': {
    delete: {
      summary: 'Delete a pending/orphaned upload by S3 key',
      requestParams: { query: deleteUploadQuery },
      responses: {
        204: { description: 'Upload deleted' },
        401: unauthorized,
        403: problem('Key does not belong to the user'),
        422: problem('Validation failed'),
      },
    },
  },
  '/billing/checkout': {
    post: {
      summary: 'Start a Stripe Checkout session',
      requestBody: { content: { 'application/json': { schema: createCheckoutInput } } },
      responses: {
        200: {
          description: 'The Stripe Checkout URL to redirect to',
          content: { 'application/json': { schema: billingRedirectSchema } },
        },
        400: problem('Invalid subscription plan'),
        401: unauthorized,
        409: problem('Already subscribed or existing subscription'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/billing/portal': {
    post: {
      summary: 'Open the Stripe Customer Portal',
      responses: {
        200: {
          description: 'The Stripe Portal URL to redirect to',
          content: { 'application/json': { schema: billingRedirectSchema } },
        },
        400: problem('No subscription found'),
        401: unauthorized,
        429: rateLimited,
      },
    },
  },
  '/billing/cancel': {
    post: {
      summary: 'Schedule subscription cancellation at period end',
      responses: {
        204: { description: 'Cancellation scheduled' },
        401: unauthorized,
        429: rateLimited,
      },
    },
  },
  '/billing/reactivate': {
    post: {
      summary: 'Reactivate a subscription scheduled for cancellation',
      responses: {
        204: { description: 'Subscription reactivated' },
        401: unauthorized,
        429: rateLimited,
      },
    },
  },
  '/auth/login': {
    post: {
      summary: 'Sign in with email & password',
      requestBody: { content: { 'application/json': { schema: loginInput } } },
      responses: {
        204: { description: 'Signed in (session cookie set)' },
        400: problem('Invalid email or password'),
        403: {
          description: 'Email not verified — carries the unverified email',
          content: { 'application/json': { schema: loginEmailNotVerifiedSchema } },
        },
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/auth/register': {
    post: {
      summary: 'Create an account',
      requestBody: { content: { 'application/json': { schema: registerInput } } },
      responses: {
        200: {
          description: 'Where to navigate after registering',
          content: { 'application/json': { schema: authRedirectSchema } },
        },
        409: problem('Email already in use (verification disabled)'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/auth/forgot-password': {
    post: {
      summary: 'Request a password reset email',
      requestBody: { content: { 'application/json': { schema: forgotPasswordInput } } },
      responses: {
        200: {
          description: 'Where to navigate after requesting a reset',
          content: { 'application/json': { schema: authRedirectSchema } },
        },
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/auth/reset-password': {
    post: {
      summary: 'Apply a password reset using a token',
      requestBody: { content: { 'application/json': { schema: resetPasswordInput } } },
      responses: {
        204: { description: 'Password reset' },
        400: problem('Reset link invalid or expired'),
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/auth/confirm-login-email': {
    post: {
      summary: 'Confirm a credential-login email (add password or re-point sign-in email)',
      requestBody: { content: { 'application/json': { schema: confirmLoginEmailInput } } },
      responses: {
        204: { description: 'Credential-login email confirmed' },
        400: problem('Confirmation link invalid or expired'),
        409: problem('Email already in use — link spent; request a new one from Profile'),
        422: problem('Validation failed or password required to finish adding sign-in'),
        429: rateLimited,
      },
    },
  },
  '/auth/resend-verification': {
    post: {
      summary: 'Resend the email verification message',
      requestBody: { content: { 'application/json': { schema: resendVerificationInput } } },
      responses: {
        204: { description: 'Verification email sent' },
        422: problem('Validation failed'),
        429: rateLimited,
      },
    },
  },
  '/auth/callback/{provider}': {
    get: {
      summary: 'NextAuth OAuth callback (provider redirect back to the app)',
      description:
        'Handled natively by the `[...nextauth]` catch-all — not a typed `api`/`$api` route. The OAuth provider redirects here with `code`/`state`; NextAuth exchanges the code, establishes the session, and 302-redirects into the app (or to the error page).',
      requestParams: { path: authCallbackProviderParam, query: authCallbackQueryParam },
      responses: {
        302: { description: 'Session established — redirect into the app (or to the error page)' },
        400: problem('Invalid or missing OAuth state/code'),
      },
    },
    post: {
      summary: 'NextAuth callback (credentials / provider form_post)',
      description:
        'Handled natively by the `[...nextauth]` catch-all — not a typed `api`/`$api` route. Used by the credentials provider and OAuth providers that POST back to the app.',
      requestParams: { path: authCallbackProviderParam },
      responses: {
        302: { description: 'Session established — redirect into the app (or to the error page)' },
        400: problem('Invalid callback request'),
      },
    },
  },
  '/download/{id}/url': {
    get: {
      summary: 'Get a signed download or preview URL for a file/image item',
      requestParams: { path: idParam, query: downloadQueryParam },
      responses: {
        200: {
          description: 'The signed S3 URL',
          content: { 'application/json': { schema: signedDownloadUrlSchema } },
        },
        400: problem('Not a file or image item'),
        401: unauthorized,
        403: problem('Pro subscription required'),
        404: problem('File not found'),
      },
    },
  },
}
