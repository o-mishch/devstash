import { ApiResponse, apiRoute } from '@/lib/api'
import { rateLimitRoute, getRequestIP } from '@/lib/rate-limit'
import { registerUser, type VerificationResult } from '@/lib/auth-service'

const MAX_PASSWORD_LENGTH = 128

interface RegisterData {
  verification: VerificationResult
}

export const POST = apiRoute(async (request) => {
  const rl = await rateLimitRoute('register', getRequestIP(request))
  if (rl) return rl

  const { name, email, password } = await request.json()

  if (!name || !email || !password) return ApiResponse.BAD_REQUEST('All fields are required.')
  if (password.length < 8) return ApiResponse.BAD_REQUEST('Password must be at least 8 characters.')
  if (password.length > MAX_PASSWORD_LENGTH) return ApiResponse.BAD_REQUEST('Password is too long.')

  const verification: VerificationResult = await registerUser(name, email, password)

  return ApiResponse.OK<RegisterData>({ verification })
})
