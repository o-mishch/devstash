import { NextRequest } from 'next/server'
import { resendVerification } from '@/lib/emails/verification'
import { ApiResponse, apiRoute } from '@/lib/api'

export const POST = apiRoute(async (request: NextRequest) => {
  const { email } = await request.json()

  if (!email) {
    return ApiResponse.BAD_REQUEST('Email is required')
  }

  await resendVerification(email)

  return ApiResponse.OK()
})
