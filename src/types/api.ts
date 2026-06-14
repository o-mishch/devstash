export type ApiStatus =
  | 'ok'
  | 'created'
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation_error'
  | 'too_many_requests'
  | 'internal_error'

export type ApiBody<T = null> = {
  status: ApiStatus
  data: T | null
  message?: string | null
}
