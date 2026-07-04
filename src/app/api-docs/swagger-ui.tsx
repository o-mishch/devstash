'use client'

import { useEffect, useState } from 'react'
import Script from 'next/script'

export function SwaggerUI() {
  const [bundleLoaded, setBundleLoaded] = useState(false)
  const [presetLoaded, setPresetLoaded] = useState(false)

  useEffect(() => {
    if (bundleLoaded && presetLoaded) {
      // SwaggerUIBundle / SwaggerUIStandalonePreset are injected onto window by the CDN scripts below;
      // type just the surface we call rather than augmenting the global Window interface.
      type SwaggerUIBundleFn = ((config: Record<string, unknown>) => unknown) & {
        presets: { apis: unknown }
      }
      const cdn = window as unknown as {
        SwaggerUIBundle?: SwaggerUIBundleFn
        SwaggerUIStandalonePreset?: unknown
        ui?: unknown
      }
      const SwaggerUIBundle = cdn.SwaggerUIBundle
      const SwaggerUIStandalonePreset = cdn.SwaggerUIStandalonePreset

      if (SwaggerUIBundle && SwaggerUIStandalonePreset) {
        cdn.ui = SwaggerUIBundle({
          url: '/api/openapi.json',
          dom_id: '#swagger-ui',
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: 'StandaloneLayout',
        })
      }
    }
  }, [bundleLoaded, presetLoaded])

  return (
    <>
      <div id="swagger-ui" />
      <Script
        src="https://unpkg.com/swagger-ui-dist@5.32.6/swagger-ui-bundle.js"
        crossOrigin="anonymous"
        onLoad={() => setBundleLoaded(true)}
      />
      <Script
        src="https://unpkg.com/swagger-ui-dist@5.32.6/swagger-ui-standalone-preset.js"
        crossOrigin="anonymous"
        onLoad={() => setPresetLoaded(true)}
      />
    </>
  )
}
