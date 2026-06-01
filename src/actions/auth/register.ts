'use server'

import { z } from 'zod'
import { redirect } from 'next/navigation'
import { ApiResponse } from '@/lib/api'
import type { ApiBody } from '@/types/api'
import { withRateLimit } from '@/lib/rate-limit'
import { registerUser, type VerificationResult } from '@/lib/auth-service'
import { validatePassword } from '@/lib/utils/validators'

export async function registerAction(
  _prevState: ApiBody<null> | null,
  formData: FormData
): Promise<ApiBody<null>> {
  return withRateLimit('register', async () => {
    const name = (formData.get('name') as string) ?? ''
    const email = (formData.get('email') as string) ?? ''
    const password = (formData.get('password') as string) ?? ''
    const confirm = (formData.get('confirmPassword') as string) ?? ''

    if (!name || !email || !password) return ApiResponse.BAD_REQUEST('All fields are required.')

    if (!z.string().email().safeParse(email).success) return ApiResponse.BAD_REQUEST('Please enter a valid email address.')

    const error = validatePassword(password, confirm)
    if (error) return ApiResponse.BAD_REQUEST(error)

    const verification: VerificationResult = await registerUser(name, email, password)

    if (verification === 'skipped') redirect('/sign-in')

    redirect(`/register?pending=1&email=${encodeURIComponent(email)}&sent=${verification === 'sent' ? '1' : '0'}`)
  })
}
