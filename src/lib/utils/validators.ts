export const MAX_PASSWORD_LENGTH = 128

export function validatePassword(password: string, confirmPassword?: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.'
  if (password.length > MAX_PASSWORD_LENGTH) return 'Password is too long.'
  if (confirmPassword !== undefined && password !== confirmPassword) return 'Passwords do not match.'
  return null
}
