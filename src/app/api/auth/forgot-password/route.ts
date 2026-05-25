import { prisma } from '@/lib/prisma'
import { ApiResponse, apiRoute } from '@/lib/api'
import { sendPasswordResetRequest } from '@/lib/emails/password-reset'

const RESET_SENT_MSG = 'If that email exists, we sent a reset link.'

/**
 * POST /api/auth/forgot-password
 * Body: { email: string }
 *
 * Generates a password-reset token and emails it to the user.
 * Always returns the same success message to prevent user enumeration.
 * No-ops silently for OAuth-only accounts (no password set).
 *
 * Responses:
 *   200 ok          — email sent (or silently skipped)
 *   400 bad_request — email field missing or invalid
 */
export const POST = apiRoute(async (request) => {
  const { email } = await request.json()

  if (!email || typeof email !== 'string') {
    return ApiResponse.BAD_REQUEST('Email is required.')
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { password: true },
  })

  if (user?.password) {
    await sendPasswordResetRequest(email)
  }

  return ApiResponse.OK(RESET_SENT_MSG)
})
