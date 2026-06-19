import { NextResponse } from 'next/server'
import { notFound } from 'next/navigation'
import spec from '../../../../openapi.json'

export function GET() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return NextResponse.json(spec)
}
