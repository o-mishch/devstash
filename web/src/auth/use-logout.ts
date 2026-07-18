import { useMutation } from '@tanstack/react-query'
import type { UseMutationResult } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { authLogoutMutation } from '@/client/@tanstack/react-query.gen'
import type { AuthLogoutData, ErrorModel, Options } from '@/client'
import { apiErrorMessage, apiErrorStatus } from '@/lib/api/errors'
import { useAuthActions } from './actions'

/**
 * Shared logout-cleanup mutation options: drop client auth state on success (falling back to a
 * plain redirect if that throws), and suppress the error toast on a 401 specifically — the
 * session was already gone, so the response interceptor has taken the logout transition and is
 * redirecting to sign-in right now. Surfacing "Unauthorized" over a visibly successful logout
 * (or, for `useDeleteAccount`, over a delete that still happened server-side) would be wrong.
 * Used by both `useLogout` and `useDeleteAccount` — the two mutations that end a session.
 */
interface LogoutCleanup {
  onSuccess: () => Promise<void>
  onError: (error: ErrorModel) => void
}

export function useLogoutCleanup(): LogoutCleanup {
  const router = useRouter()
  const { onLoggedOut } = useAuthActions()
  return {
    onSuccess: async () => {
      try {
        await onLoggedOut()
      } catch {
        await router.navigate({ to: '/sign-in' })
      }
    },
    onError: (error) => {
      if (apiErrorStatus(error) === 401) return
      toast.error(apiErrorMessage(error))
    },
  }
}

/** Log out: clear the server session, drop client auth state, redirect to sign-in. */
export function useLogout(): UseMutationResult<void, ErrorModel, Options<AuthLogoutData>> {
  return useMutation({
    ...authLogoutMutation(),
    ...useLogoutCleanup(),
  })
}
