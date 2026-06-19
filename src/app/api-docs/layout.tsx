import type { ReactNode } from 'react'

interface ApiDocsLayoutProps {
  children: ReactNode
}

export default function ApiDocsLayout({ children }: ApiDocsLayoutProps) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>DevStash API Docs</title>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.32.6/swagger-ui.css" />
      </head>
      <body>{children}</body>
    </html>
  )
}
