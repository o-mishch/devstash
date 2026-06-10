// Caches Filebase image bytes keyed by object path (strips S3 signature query params).
// Signed URLs rotate every 15 min — path stays the same, so rotated URLs still hit the cache.
// Entries older than TTL_MS are evicted lazily on each cache hit check.

const CACHE_NAME = 'filebase-images-v1'
const FILEBASE_ORIGIN = 'https://s3.filebase.io'
const TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function pathKey(url) {
  const u = new URL(url)
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
  if (!event.request.url.startsWith(FILEBASE_ORIGIN)) return

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const key = pathKey(event.request.url)
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
