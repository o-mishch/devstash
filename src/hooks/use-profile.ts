'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { $api } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { useInvalidate } from '@/hooks/use-cache-invalidation'
import { previewCredentialEmailChange, previewCredentialEmailRemoval } from '@/lib/utils/auth'
import type { ProfileContextResponse } from '@/lib/api/schemas/profile'

interface UseProfileOptions {
  initialData?: ProfileContextResponse
}

/**
 * The profile page's rich read (account summary, avatar, emails, sign-in methods, stats). SSR-seeded via
 * `initialData` so it paints instantly. Mutations on the page patch this cache optimistically through the
 * `usePatch*` hooks below — the single source of truth for the email/account controls (this replaces the
 * former `profile-emails` Zustand store, keeping server-derived state in the query cache per the State
 * Management rule).
 */
export function useProfile(options?: UseProfileOptions) {
  // init `undefined` (not `{}`) so the observed key is `['get','/profile']` — the exact key the
  // `usePatch*` hooks write via `setQueryData(queryKeys.profile())`. A `{}` init keys to
  // `['get','/profile',{}]`, which an exact-key setQueryData can't reach (optimistic patches lost).
  return $api.useQuery(
    'get',
    '/profile',
    undefined,
    { initialData: options?.initialData, meta: { errorMessage: 'Failed to load profile' } },
  )
}

type ProfilePatch = Partial<ProfileContextResponse>

/**
 * Central post-success updater for the `/profile` cache (callers invoke it in `onSuccess` — a cache
 * reconciler, not a pre-await optimistic update). Accepts a partial or an `(old) => partial` updater so
 * credential/account mutations can derive the next emails/accounts from the current snapshot. Marks the
 * cache stale with `refetchType: 'none'` — GET /profile is `'use cache'` busted via a deferred
 * `revalidateTag`, so an instant refetch would race; it reconciles on the next focus/navigation. Mirrors
 * `usePatchItem` / `usePatchUserProfile`.
 */
export function usePatchProfile() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidate()
  return useCallback(
    (patch: ProfilePatch | ((old: ProfileContextResponse) => ProfilePatch)) => {
      queryClient.setQueryData<ProfileContextResponse>(queryKeys.profile(), (old) => {
        if (!old) return old
        return { ...old, ...(typeof patch === 'function' ? patch(old) : patch) }
      })
      invalidate('profile', { refetchType: 'none' })
    },
    [queryClient, invalidate],
  )
}

/** Reflect a newly added Email & Password login (SetPasswordDialog). */
export function useAddCredentialLogin() {
  const patchProfile = usePatchProfile()
  return useCallback(
    (email: string) =>
      patchProfile((old) => ({
        hasPassword: true,
        credentialEmail: email,
        availableEmails: old.availableEmails.includes(email)
          ? old.availableEmails
          : [...old.availableEmails, email],
      })),
    [patchProfile],
  )
}

/** Reflect a changed sign-in email (ChangeCredentialEmailDialog) — re-points credentialEmail, adjusting the
 * available list and the primary email when they move together. */
export function useChangeCredentialLogin() {
  const patchProfile = usePatchProfile()
  return useCallback(
    (email: string) =>
      patchProfile((old) => {
        const preview = previewCredentialEmailChange(
          {
            currentEmail: old.email,
            availableEmails: old.availableEmails,
            credentialEmail: old.credentialEmail,
            linkedAccounts: old.accounts,
          },
          email,
        )
        return {
          credentialEmail: preview.credentialEmail,
          availableEmails: preview.availableEmails,
          ...(preview.currentEmail !== undefined ? { email: preview.currentEmail } : {}),
        }
      }),
    [patchProfile],
  )
}

/** Reflect a removed Email & Password login (RemovePasswordDialog). */
export function useRemoveCredentialLogin() {
  const patchProfile = usePatchProfile()
  return useCallback(
    () =>
      patchProfile((old) => {
        const preview = previewCredentialEmailRemoval({
          currentEmail: old.email,
          availableEmails: old.availableEmails,
          credentialEmail: old.credentialEmail,
          linkedAccounts: old.accounts,
        })
        return {
          hasPassword: false,
          credentialEmail: null,
          availableEmails: preview.availableEmails,
          email: preview.currentEmail,
        }
      }),
    [patchProfile],
  )
}

/** Reflect an unlinked OAuth account (ProfileActionDialog), dropping its email from the available list when
 * no other method still owns it. */
export function useRemoveLinkedAccount() {
  const patchProfile = usePatchProfile()
  return useCallback(
    (id: string) =>
      patchProfile((old) => {
        const removed = old.accounts.find((a) => a.id === id)
        const accounts = old.accounts.filter((a) => a.id !== id)
        const availableEmails =
          removed?.email && !accounts.some((a) => a.email === removed.email)
            ? old.availableEmails.filter((e) => e !== removed.email)
            : old.availableEmails
        return { accounts, availableEmails }
      }),
    [patchProfile],
  )
}

/**
 * Clears the user-scoped caches — called on sign-out / account deletion so one user's PII (profile
 * emails, billing email + Stripe IDs) never lingers for the next sign-in on a shared device (replaces
 * the old `profile-emails` store reset()).
 */
export function useResetProfile() {
  const queryClient = useQueryClient()
  return useCallback(() => {
    queryClient.removeQueries({ queryKey: queryKeys.profile() })
    queryClient.removeQueries({ queryKey: queryKeys.userProfile() })
    queryClient.removeQueries({ queryKey: queryKeys.editorPreferences() })
    queryClient.removeQueries({ queryKey: queryKeys.billingContext() })
  }, [queryClient])
}
