/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

// Type the custom `VITE_*` env vars the app reads. Vite's base `ImportMetaEnv`
// carries a `[key: string]: any` index signature, so an undeclared `import.meta.env.*`
// access lands as `any` and trips the type-aware `no-unsafe-*` lint rules. Declaring
// each var here overrides that index signature for the known key with an honest type.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  // Where the site itself is served (canonical/OG/sitemap origin). Injected in prod by the
  // web Cloud Build step from Terraform's firebase_custom_domain; see src/lib/site-config.ts.
  readonly VITE_SITE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
