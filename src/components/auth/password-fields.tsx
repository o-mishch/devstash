import { AuthFormField } from './auth-form-field'

export function PasswordFields({ passwordLabel = 'Password' }: { passwordLabel?: string }) {
  return (
    <>
      <AuthFormField
        id="password"
        name="password"
        label={passwordLabel}
        type="password"
        placeholder="••••••••"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <AuthFormField
        id="confirmPassword"
        name="confirmPassword"
        label="Confirm password"
        type="password"
        placeholder="••••••••"
        autoComplete="new-password"
        minLength={8}
        required
      />
    </>
  )
}
