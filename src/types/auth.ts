/** Returned by the login route on a verification block — carries the unverified email for the resend prompt. */
export interface SignInData {
  email: string
}

/** Returned by auth routes that previously redirected server-side — the client navigates to `redirectTo`. */
export interface AuthRedirectData {
  redirectTo: string
}
