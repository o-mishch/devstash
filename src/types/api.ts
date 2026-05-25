export type ApiSuccess<T extends Record<string, unknown> = Record<string, never>> = {
  success: true
} & T

export type ApiError = {
  success: false
  message: string
}

export type ApiResponse<T extends Record<string, unknown> = Record<string, never>> =
  | ApiSuccess<T>
  | ApiError
