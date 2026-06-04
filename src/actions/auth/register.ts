'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'
import { withRateLimit } from '@/lib/rate-limit'
import { registerUser, type VerificationResult } from '@/lib/auth-service'
import { validatePassword, parseOrFail, EmailSchema } from '@/lib/utils/validators'

export async function registerAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withRateLimit('register', async () => {
    const name = (formData.get('name') as string) ?? ''
    const password = (formData.get('password') as string) ?? ''
    const confirm = (formData.get('confirmPassword') as string) ?? ''

    const emailResult = parseOrFail(EmailSchema, formData.get('email'))
    if (!emailResult.success) return emailResult.response
    const email = emailResult.data

    if (!name || !password) return ApiResponse.BAD_REQUEST('All fields are required.')

    const error = validatePassword(password, confirm)
    if (error) return ApiResponse.BAD_REQUEST(error)

    const verification: VerificationResult = await registerUser(name, email, password)

    if (verification === 'skipped') redirect('/sign-in')

    redirect(`/register?pending=1&email=${encodeURIComponent(email)}&sent=${verification === 'sent' ? '1' : '0'}`)
  })
}
