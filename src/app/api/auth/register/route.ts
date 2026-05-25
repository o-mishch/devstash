import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import {
  emailVerificationEnabled,
  sendRegistrationVerification,
  type VerificationResult,
} from '@/lib/emails/verification'
import type { ApiResponse } from '@/types/api'

type RegisterResponseData = { verification: VerificationResult }

export async function POST(request: NextRequest) {
  try {
    const { name, email, password } = await request.json()

    if (!name || !email || !password) {
      return NextResponse.json<ApiResponse>(
        { success: false, message: 'All fields are required' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json<ApiResponse>(
        { success: false, message: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    const verificationEnabled = emailVerificationEnabled()
    const existing = await prisma.user.findUnique({ where: { email } })

    if (existing) {
      // Mirror what a new user would see — prevents email enumeration
      const verification: VerificationResult = verificationEnabled ? 'sent' : 'skipped'
      return NextResponse.json<ApiResponse<RegisterResponseData>>(
        { success: true, verification },
        { status: 200 }
      )
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    await prisma.user.create({
      data: { name, email, password: hashedPassword, emailVerified: verificationEnabled ? undefined : new Date() },
    })
    const verification: VerificationResult = verificationEnabled
      ? await sendRegistrationVerification(email)
      : 'skipped'
    return NextResponse.json<ApiResponse<RegisterResponseData>>(
      { success: true, verification },
      { status: 200 }
    )
  } catch {
    return NextResponse.json<ApiResponse>(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    )
  }
}
