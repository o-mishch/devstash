'use client'

import { useEffect, useState } from 'react'
import Script from 'next/script'

export function SwaggerUI() {
  const [bundleLoaded, setBundleLoaded] = useState(false)
  const [presetLoaded, setPresetLoaded] = useState(false)

  useEffect(() => {
    if (bundleLoaded && presetLoaded) {
      // @ts-expect-error: SwaggerUIBundle is loaded dynamically via CDN
      const SwaggerUIBundle = window.SwaggerUIBundle
      // @ts-expect-error: SwaggerUIStandalonePreset is loaded dynamically via CDN
      const SwaggerUIStandalonePreset = window.SwaggerUIStandalonePreset

      if (SwaggerUIBundle && SwaggerUIStandalonePreset) {
        // @ts-expect-error: window.ui is not declared on Window interface
        window.ui = SwaggerUIBundle({
          url: '/api/openapi.json',
          dom_id: '#swagger-ui',
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset,
          ],
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
