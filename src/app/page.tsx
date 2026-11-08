import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { AppShell } from '@/components/app-shell'

// Server component: renders the client shell AND generates per-title
// social metadata for /?w=<resourceId> deep links. Public fields only —
// the YouTube video id never appears in metadata or payloads.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ w?: string }>
}): Promise<Metadata> {
  const { w } = await searchParams
  if (!w) return {}

  const r = await db.resource.findUnique({
    where: { id: w },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      producer: { select: { name: true } },
    },
  })
  if (!r || r.status !== 'PUBLISHED') return {}

  const title = `${r.title} — StreamRoots`
  const description =
    r.description ||
    `Watch ${r.title}${r.producer?.name ? ` by ${r.producer.name}` : ''} on StreamRoots — stories from home, straight to the diaspora.`
  const image = `/api/thumb/${r.id}?q=hd`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'video.other',
      images: [{ url: image, width: 1280, height: 720 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  }
}

export default function Page() {
  return <AppShell />
}
