import { describe, it, expect } from 'vitest'
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { contract } from './index'

// Proves every procedure is OpenAPI-spec-generatable (mobile/REST forward-compat goal).
describe('OpenAPI spec generation', () => {
  it('generates a valid OpenAPI 3.x doc with each migrated domain as REST routes', async () => {
    const generator = new OpenAPIGenerator({ schemaConverters: [new ZodToJsonSchemaConverter()] })
    const spec = await generator.generate(contract, { info: { title: 'DevStash API', version: '1.0.0' } })

    expect(spec.openapi).toMatch(/^3\./)
    const ops = Object.entries(spec.paths ?? {}).flatMap(([p, item]) =>
      Object.keys(item as object).map((m) => `${m.toUpperCase()} ${p}`),
    )
    // Assert presence (not exact equality) so the set grows as more domains migrate.
    expect(ops).toEqual(
      expect.arrayContaining([
        'DELETE /collections/{id}',
        'GET /collections',
        'PATCH /collections/{id}',
        'PATCH /collections/{id}/favorite',
        'POST /collections',
        'GET /items',
        'POST /items',
        'PATCH /items/{id}',
        'DELETE /items/{id}',
        'GET /items/{id}/details',
        'GET /items/{id}/content',
        'PATCH /items/{id}/favorite',
        'PATCH /items/{id}/pinned',
      ]),
    )
  })
})
