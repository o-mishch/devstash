import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { openApiDocument } from '@/lib/api/openapi/spec'

// Build-time tooling — NOT application code. Invoked only by `npm run openapi:gen` via tsx (like the
// other scripts in this folder); it is imported by nothing in the Next.js graph, so it is never
// bundled or shipped to the runtime. Writes the generated OpenAPI document to ./openapi.json
// (committed); the script then runs `openapi-typescript` over it to produce ./src/types/openapi.ts.
// Both artifacts are committed and a no-diff gate fails CI if regenerating produces a diff.

const outPath = resolve(process.cwd(), 'openapi.json')
writeFileSync(outPath, `${JSON.stringify(openApiDocument, null, 2)}\n`)
console.log(`Wrote OpenAPI document → ${outPath}`)
