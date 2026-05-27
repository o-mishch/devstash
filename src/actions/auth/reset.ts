'use server'

import { redirect } from 'next/navigation'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'
import { withRateLimit } from '@/lib/rate-limit'
import { triggerPasswordReset, applyPasswordReset } from '@/lib/auth-service'
import { validatePassword } from '@/lib/utils/validators'

export async function resetPasswordAction(
  token: string,
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withRateLimit('resetPassword', async () => {
    const password = (formData.get('password') as string) ?? ''
    const confirm = (formData.get('confirmPassword') as string) ?? ''

    const error = validatePassword(password, confirm)
    if (error) return ApiResponse.BAD_REQUEST(error)

    const result = await applyPasswordReset(token, password)

    if (result !== 'ok') return ApiResponse.BAD_REQUEST('This reset link is invalid or has expired.')

    return ApiResponse.OK()
  })
}

export async function forgotPasswordAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  const email = (formData.get('email') as string) ?? ''

  if (!email) return ApiResponse.BAD_REQUEST('Email is required.')

  return withRateLimit('forgotPassword', async () => {
    await triggerPasswordReset(email)

    redirect(`/forgot-password?sent=1&email=${encodeURIComponent(email)}`)
  })
}
