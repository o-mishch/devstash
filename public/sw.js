// Caches S3 thumbnail bytes keyed by object path (strips presigned query params).
// Thumbnails (-thumb.webp) are the high-frequency requests — loaded on every grid
// view. Full-size images are single-use per drawer open and not cached here.
// Presigned URLs rotate every 15 min — the path stays the same, so a rotated URL
// still hits the cache. Only intercepts image-destination requests so that file
// downloads (which embed Content-Disposition in their signed URL) are never affected.
// Entries older than TTL_MS are evicted lazily on each cache hit check.

const CACHE_NAME = 's3-thumbs-v1'
const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function parseUrl(url) {
  try { return new URL(url) } catch { return null }
}

function pathKey(u) {
  return u.origin + u.pathname
}

function isFresh(response) {
  const cachedAt = response.headers.get('x-sw-cached-at')
  if (!cachedAt) return false
  return Date.now() - Number(cachedAt) < TTL_MS
}

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  // Only cache <img>-initiated presigned S3 thumbnail requests.
  // File downloads embed Content-Disposition in the signed URL — caching by path
  // only would lose that header if a download is served from cache.
  if (event.request.destination !== 'image') return
  const u = parseUrl(event.request.url)
  if (!u || !u.searchParams.has('X-Amz-Signature')) return
  if (!u.pathname.endsWith('-thumb.webp')) return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const key = pathKey(u)
      const cached = await cache.match(key)
      if (cached && isFresh(cached)) return cached

      const response = await fetch(event.request)
      if (response.ok) {
        const headers = new Headers(response.headers)
        headers.set('x-sw-cached-at', String(Date.now()))
        cache.put(key, new Response(response.clone().body, { status: response.status, headers }))
      }
      return response
    })
  )
})
