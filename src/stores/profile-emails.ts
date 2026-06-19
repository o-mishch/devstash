import { create } from 'zustand'
import {
  previewCredentialEmailChange,
  previewCredentialEmailRemoval,
  type ProfileEmailsPreviewState,
} from '@/lib/utils/auth'

export interface ProfileEmailsState extends ProfileEmailsPreviewState {
  // Whether an Email & Password (credential) login exists.
  hasCredentialLogin: boolean
}

interface ProfileEmailsStore extends ProfileEmailsState {
  initialize: (state: ProfileEmailsState) => void
  reset: () => void
  setCurrentEmail: (email: string) => void
  addCredentialLogin: (email: string) => void
  changeCredentialLogin: (email: string) => void
  removeCredentialLogin: () => void
  removeLinkedAccount: (id: string) => void
}

// Empty defaults — this module-global store must never expose one user's emails (PII) to the next
// after a client-side sign-out, so it is reset to this on sign-out / account deletion.
const EMPTY_STATE: ProfileEmailsState = {
  currentEmail: '',
  availableEmails: [],
  hasCredentialLogin: false,
  credentialEmail: null,
  linkedAccounts: [],
}

// Shared client state for the profile page's email controls. The Account-Information email dropdown
// (MainEmailSelector) and the Sign-in Methods list (ConnectedAccounts) live in separate cards but must
// stay in sync when a credential login is added/removed — the server re-render lags behind the route
// handler's stale-while-revalidate cache, so we reflect mutations here immediately (same rationale as
// EditableName / MainEmailSelector owning their display state locally).
export const useProfileEmailsStore = create<ProfileEmailsStore>((set) => ({
  ...EMPTY_STATE,
  initialize: (state) => set(state),
  reset: () => set(EMPTY_STATE),
  setCurrentEmail: (email) => set({ currentEmail: email }),
  addCredentialLogin: (email) =>
    set((state) => ({
      hasCredentialLogin: true,
      credentialEmail: email,
      availableEmails: state.availableEmails.includes(email)
        ? state.availableEmails
        : [...state.availableEmails, email],
    })),
  changeCredentialLogin: (email) => set((state) => previewCredentialEmailChange(state, email)),
  removeCredentialLogin: () => set((state) => previewCredentialEmailRemoval(state)),
  removeLinkedAccount: (id) =>
    set((state) => {
      const removed = state.linkedAccounts.find((a) => a.id === id)
      const linkedAccounts = state.linkedAccounts.filter((a) => a.id !== id)
      const availableEmails =
        removed?.email && !linkedAccounts.some((a) => a.email === removed.email)
          ? state.availableEmails.filter((e) => e !== removed.email)
          : state.availableEmails
      return { linkedAccounts, availableEmails }
    }),
}))
