export interface ActionState<T = null> {
  success: boolean
  data?: T | null
  message?: string | null
}
