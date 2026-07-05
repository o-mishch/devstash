// Single source of truth for the Pro-gate on Pro-only pages (/parse, /items/files, /items/images).
// Client-safe: imported by the edge auth config (path → feature), the /upgrade dialog trigger
// (feature → copy), and the sidebar click gates. The API/route layer is the real Pro gate; this
// only drives the pre-redirect flash removal and the "Pro Feature" dialog copy.

export type ProGateFeature = 'brain-dump' | 'files' | 'images'

// feature → the exact "Pro Feature" dialog body shown both on a direct-URL redirect and a nav click.
// A Record over ProGateFeature makes a missing entry a compile error, so proGateFeatureForPath can
// never emit a token with no matching copy (which would silently open no dialog).
export const PRO_GATE_COPY: Record<ProGateFeature, string> = {
  'brain-dump': 'Creating brain dump is a Pro feature.',
  files: 'Creating files is a Pro feature.',
  images: 'Creating images is a Pro feature.',
}

export function isProGateFeature(value: string | null | undefined): value is ProGateFeature {
  return value != null && value in PRO_GATE_COPY
}

// Pro-only page path → its gate feature, or null for any other route. Matched by exact path (or a
// job sub-path for /parse) so only these routes redirect — `/items/notes` etc. are unaffected.
export function proGateFeatureForPath(pathname: string): ProGateFeature | null {
  if (pathname === '/parse' || pathname.startsWith('/parse/')) return 'brain-dump'
  if (pathname === '/items/files') return 'files'
  if (pathname === '/items/images') return 'images'
  return null
}
