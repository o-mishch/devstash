import { notFound } from 'next/navigation'
import { SwaggerUI } from './swagger-ui'

export default function ApiDocsPage() {
  if (process.env.NODE_ENV !== 'development') notFound()

  return <SwaggerUI />
}
