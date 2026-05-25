import { Resend } from 'resend'

export const resend = new Resend(process.env.RESEND_API_KEY)

// Use a verified domain in production; onboarding@resend.dev is for testing only
export const EMAIL_FROM = process.env.EMAIL_FROM ?? 'DevStash <onboarding@resend.dev>'

export const BASE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
