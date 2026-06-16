import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { openApiDocument } from './spec'

// Drift guard: the committed openapi.json must match what re-deriving the document from the Zod
// schemas + paths.ts produces. Replaces the deleted contract.spec-gen.test.ts and gives the no-diff
// gate teeth without needing CI — if a schema/path changed but `npm run openapi:gen` wasn't run, this
// fails. The comparison mirrors scripts/generate-openapi.ts byte-for-byte (pretty JSON + trailing
// newline) so formatting drift is caught too.

describe('openapi.json', () => {
  it('matches the document re-derived from the schemas (run `npm run openapi:gen` if this fails)', () => {
    const committed = readFileSync(resolve(process.cwd(), 'openapi.json'), 'utf8')
    const regenerated = `${JSON.stringify(openApiDocument, null, 2)}\n`
    expect(committed).toBe(regenerated)
  })
})
