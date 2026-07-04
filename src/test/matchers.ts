import { expect } from 'vitest'

// Vitest types `expect.objectContaining` / `arrayContaining` / `anything` as `any`,
// which trips @typescript-eslint/no-unsafe-assignment when the matcher is nested inside
// an object/array literal (a very common `toHaveBeenCalledWith` shape). These thin
// wrappers keep the exact runtime matcher while returning a non-`any` type.
//
// The `as never` casts below are intentional: Vitest's matcher return type is `any`, and
// `never` is the only type that safely bridges `any` → a generic `T` without leaking
// `any` into the caller's type context. If Vitest ships typed matchers in a future major,
// these casts can be removed.

export function objectContaining<T>(shape: T): T {
  return expect.objectContaining(shape as never) as T
}

export function arrayContaining<T>(items: T[]): T[] {
  return expect.arrayContaining(items as never[]) as T[]
}

export function stringContaining(substring: string): string {
  return expect.stringContaining(substring) as string
}

export function anything(): unknown {
  return expect.anything()
}

// Matches any instance of the given constructor (e.g. `anyOf(Date)`); the vitest `expect.any`
// return type is `any`.
export function anyOf(constructor: abstract new (...args: never) => unknown): unknown {
  return expect.any(constructor)
}

// `Response.json()` returns `any`; this reads it as a typed value so assertions don't trip
// @typescript-eslint/no-unsafe-*. The default `DefaultJsonBody` covers single-level
// field checks; pass an explicit shape for nested access.
type DefaultJsonBody = Record<string, unknown>

export async function readJson<T = DefaultJsonBody>(res: Response): Promise<T> {
  return (await res.json()) as T
}

