import 'server-only'
import { OpenAPIGenerator } from '@orpc/openapi'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import { router } from './router'

// Optional, mobile/external-facing. The web client does not need this — the spec is generatable
// on demand from the same router via `generateOpenApiSpec()`.
export const openApiGenerator = new OpenAPIGenerator({
  schemaConverters: [new ZodToJsonSchemaConverter()],
})

export const generateOpenApiSpec = () =>
  openApiGenerator.generate(router, { info: { title: 'DevStash API', version: '1.0.0' } })
