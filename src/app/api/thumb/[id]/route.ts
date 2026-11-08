import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { db } from '@/lib/db'

// ── Poster proxy: variants + hard caching + ETag/304 ────────────────
// Keeps the YouTube video id out of every public payload — the client
// only ever sees /api/thumb/<resourceId>[:?q=m|q=hd].
//   ?q=m    → mqdefault.jpg  (320×180, ~10 KB)   Data Saver
//   (none)  → hqdefault.jpg  (480×360)            cards / rows
//   ?q=hd   → maxresdefault → sddefault → hqdefault (hero / OG)
// Thumbnails are public marketing assets, so no auth. Responses carry
// an ETag (revalidation → 304) and immutable browser caching.
// Note: YouTube serves a ~1 KB grey placeholder image for missing
// sizes instead of a 404 — anything below 1 KB is treated as missing.

type Variant = 'm' | 'default' | 'hd'

const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX = 400
const cache = new Map<string, { buf: Buffer; ct: string; etag: string; exp: number }>()

function cacheGet(key: string) {
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.exp < Date.now()) {
    cache.delete(key)
    return null
  }
  return hit
}

function cachePut(key: string, value: { buf: Buffer; ct: string }) {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, {
    ...value,
    etag: `"${createHash('sha1').update(value.buf).digest('hex')}"`,
    exp: Date.now() + CACHE_TTL_MS,
  })
}

async function fetchBin(url: string): Promise<{ buf: Buffer; ct: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok || !res.body) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 1000) return null // grey "no thumbnail" placeholder
    return { buf, ct: res.headers.get('content-type') ?? 'image/jpeg' }
  } catch {
    return null
  }
}

function respond(req: NextRequest, hit: { buf: Buffer; ct: string; etag: string }) {
  const headers: Record<string, string> = {
    ETag: hit.etag,
    'Cache-Control': 'public, max-age=604800, immutable',
  }
  if (req.headers.get('if-none-match') === hit.etag) {
    return new NextResponse(null, { status: 304, headers })
  }
  return new NextResponse(new Uint8Array(hit.buf), {
    status: 200,
    headers: { ...headers, 'Content-Type': hit.ct, 'Content-Length': String(hit.buf.length) },
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const q = req.nextUrl.searchParams.get('q')
  const variant: Variant = q === 'm' ? 'm' : q === 'hd' ? 'hd' : 'default'

  const resource = await db.resource.findUnique({
    where: { id },
    select: { posterUrl: true, sourceRef: true, videoSourceType: true },
  })
  if (!resource) return new NextResponse(null, { status: 404 })

  // Custom posters bypass the YouTube ladder; low variant reuses one fetch.
  if (resource.posterUrl && /^https?:\/\//.test(resource.posterUrl)) {
    const key = `${id}:custom:${variant === 'm' ? 'm' : 'full'}`
    const hit = cacheGet(key)
    if (hit) return respond(req, hit)
    const got = await fetchBin(resource.posterUrl)
    if (!got) return new NextResponse(null, { status: 404 })
    cachePut(key, got)
    return respond(req, cacheGet(key)!)
  }

  if (resource.videoSourceType !== 'YOUTUBE' || !resource.sourceRef)
    return new NextResponse(null, { status: 404 })

  const key = `${id}:${variant}`
  const hit = cacheGet(key)
  if (hit) return respond(req, hit)

  const ladder =
    variant === 'm'
      ? ['mqdefault.jpg']
      : variant === 'hd'
        ? ['maxresdefault.jpg', 'sddefault.jpg', 'hqdefault.jpg']
        : ['hqdefault.jpg']

  for (const file of ladder) {
    const got = await fetchBin(`https://i.ytimg.com/vi/${resource.sourceRef}/${file}`)
    if (got) {
      cachePut(key, got)
      return respond(req, cacheGet(key)!)
    }
  }
  return new NextResponse(null, { status: 404 })
}
