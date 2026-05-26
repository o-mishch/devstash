import { NextRequest } from 'next/server'
import bcrypt from 'bcryptjs'
import { BCRYPT_ROUNDS } from '@/auth.config'
import { prisma } from '@/lib/prisma'
import {
  emailVerificationEnabled,
  sendRegistrationVerification,
  type VerificationResult,
} from '@/lib/emails/verification'
import { ApiResponse, apiRoute } from '@/lib/api'

interface RegisterData {
  verification: VerificationResult
}

export const POST = apiRoute(async (request: NextRequest) => {
  const { name, email, password } = await request.json()

  if (!name || !email || !password) {
    return ApiResponse.BAD_REQUEST('All fields are required')
  }

  if (password.length < 8) {
    return ApiResponse.BAD_REQUEST('Password must be at least 8 characters')
  }

  const verificationEnabled = emailVerificationEnabled()
  const existing = await prisma.user.findUnique({ where: { email } })

  if (existing) {
    // Mirror what a new user would see — prevents email enumeration
    const verification: VerificationResult = verificationEnabled ? 'sent' : 'skipped'
    return ApiResponse.OK<RegisterData>({ verification })
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS)
  await prisma.user.create({
    data: {
      name,
      email,
      password: hashedPassword,
      emailVerified: verificationEnabled ? undefined : new Date(),
    },
  })

  const verification: VerificationResult = verificationEnabled
    ? await sendRegistrationVerification(email)
    : 'skipped'

  return ApiResponse.OK<RegisterData>({ verification })
})
