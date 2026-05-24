import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { sendVerificationEmail } from '@/lib/emails/verification'
import { createVerificationToken } from '@/lib/tokens'

export async function POST(request: NextRequest) {
  try {
    const { name, email, password } = await request.json()

    if (!name || !email || !password) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    const existing = await prisma.user.findUnique({ where: { email } })

    if (!existing) {
      const hashedPassword = await bcrypt.hash(password, 12)
      await prisma.user.create({
        data: { name, email, password: hashedPassword },
      })
      const token = await createVerificationToken(email)
      const emailSent = await sendVerificationEmail(email, token)
      return NextResponse.json({ success: true, emailSent }, { status: 200 })
    }

    return NextResponse.json({ success: true, emailSent: true }, { status: 200 })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
