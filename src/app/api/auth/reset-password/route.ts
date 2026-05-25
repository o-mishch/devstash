import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { ApiResponse, apiRoute } from '@/lib/api'
import { consumePasswordResetToken } from '@/lib/tokens'

export const POST = apiRoute(async (request) => {
  const { token, password } = await request.json()

  if (!token || typeof token !== 'string') {
    return ApiResponse.BAD_REQUEST('Token is required.')
  }
  if (!password || typeof password !== 'string' || password.length < 8) {
    return ApiResponse.BAD_REQUEST('Password must be at least 8 characters.')
  }

  const result = await consumePasswordResetToken(token)

  if (!result) {
    return ApiResponse.BAD_REQUEST('This reset link is invalid or has expired.')
  }

  const user = await prisma.user.findUnique({
    where: { email: result.email },
    select: { id: true, password: true },
  })

  if (!user?.password) {
    return ApiResponse.BAD_REQUEST('This account uses social sign-in and has no password.')
  }

  const hashed = await bcrypt.hash(password, 12)

  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed },
  })

  return ApiResponse.OK('Password updated. You can now sign in.')
})
