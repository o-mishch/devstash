import { createDocument } from 'zod-openapi'
import { paths } from './paths'
import { webhooks } from './webhooks'

// Assembles the OpenAPI 3.1 document from the per-domain path declarations + the shared Zod schemas.
// [C] — pure (schemas only). Run by `npm run openapi:gen` (src/lib/api/openapi/generate.ts).

export const openApiDocument = createDocument(
  {
    openapi: '3.1.0',
    info: { title: 'DevStash API', version: '1.0.0' },
    paths,
    webhooks,
  },
  {
    // Schemas carrying a `.meta({ id })` (e.g. Collection, ItemType) always become reusable $ref
    // components. We deliberately keep the default `reused: 'inline'` rather than `'ref'`: in
    // zod-openapi v6 `'ref'` also hoists every repeated *primitive* (z.string(), etc.) into
    // anonymous `__schemaN` components, which bloats the generated client types with indirection.
    // §6.4 Option A: keep `z.date()`/`z.coerce.date()` in the schemas; emit `date-time` strings in
    // the OUTPUT context so the generated client receives `string` (the honest JSON wire type).
    override: ({ jsonSchema, zodSchema, io }) => {
      if (zodSchema._zod.def.type === 'date' && io === 'output') {
        jsonSchema.type = 'string'
        jsonSchema.format = 'date-time'
      }
    },
  },
)
