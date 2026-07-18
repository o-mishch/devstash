import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult } from '@tanstack/react-query'
import { toast } from 'sonner'
import { deleteAccountMutation, updateProfileMutation } from '@/client/@tanstack/react-query.gen'
import type {
  DeleteAccountData,
  ErrorModel,
  Options,
  ProfileOutputBody,
  UpdateProfileData,
} from '@/client'
import { sessionQueryOptions } from '@/auth/session'
import { toastMutationError } from '@/lib/api/errors'
import { useLogoutCleanup } from '@/auth/use-logout'

/** Update the account display name; refreshes the session so the sidebar/header name updates. */
export function useUpdateProfile(): UseMutationResult<
  ProfileOutputBody,
  ErrorModel,
  Options<UpdateProfileData>
> {
  const queryClient = useQueryClient()
  return useMutation({
    ...updateProfileMutation(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionQueryOptions.queryKey })
      toast.success('Profile updated.')
    },
    onError: toastMutationError,
  })
}

/** Permanently delete the account, then drop client auth state and redirect to sign-in. */
export function useDeleteAccount(): UseMutationResult<
  void,
  ErrorModel,
  Options<DeleteAccountData>
> {
  const cleanup = useLogoutCleanup()
  return useMutation({
    ...deleteAccountMutation(),
    ...cleanup,
    onSuccess: async () => {
      toast.success('Your account has been deleted.')
      await cleanup.onSuccess()
    },
  })
}
