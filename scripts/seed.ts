/**
 * StreamRoots demo seed — wipes and rebuilds the demo dataset.
 * Run: bun scripts/seed.ts
 */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/password'

const db = new PrismaClient()
const DAY = 24 * 60 * 60 * 1000

async function main() {
  await db.auditLog.deleteMany()
  await db.payoutEntry.deleteMany()
  await db.viewingProgress.deleteMany()
  await db.purchase.deleteMany()
  await db.membership.deleteMany()
  await db.playlistItem.deleteMany()
  await db.playlist.deleteMany()
  await db.resource.deleteMany()
  await db.notification.deleteMany()
  await db.user.deleteMany()

  const pw = hashPassword('demo1234')
  const admin = await db.user.create({
    data: { email: 'admin@demo.stream', name: 'Sara Menon', passwordHash: pw, role: 'ADMIN' },
  })
  const amara = await db.user.create({
    data: { email: 'producer@demo.stream', name: 'Amara Diallo', passwordHash: pw, role: 'PRODUCER' },
  })
  const kwame = await db.user.create({
    data: { email: 'producer2@demo.stream', name: 'Kwame Osei', passwordHash: pw, role: 'PRODUCER' },
  })
  const maya = await db.user.create({
    data: { email: 'viewer@demo.stream', name: 'Maya Chen', passwordHash: pw, role: 'VIEWER' },
  })
  await db.user.create({
    data: { email: 'viewer2@demo.stream', name: 'Leo Park', passwordHash: pw, role: 'VIEWER' },
  })

  await db.membership.create({
    data: {
      userId: maya.id,
      status: 'ACTIVE',
      plan: 'MONTHLY',
      priceCents: 799,
      expiresAt: new Date(Date.now() + 30 * DAY),
      provider: 'DEMO',
    },
  })

  // Blender Foundation open movies (CC-BY) — real, embeddable, rights-clean.
  const bbb = await db.resource.create({
    data: {
      title: 'Big Buck Bunny',
      description:
        'A gentle giant rabbit takes sweet revenge on three forest bullies. The classic Blender open movie that coined a genre — warm, silly and beautifully animated.',
      genre: 'Animation',
      year: 2008,
      videoSourceType: 'YOUTUBE',
      sourceRef: 'YE7VzlLtp-4',
      pricingType: 'FREE',
      status: 'PUBLISHED',
      producerId: amara.id,
      viewCount: 128,
    },
  })
  const sintel = await db.resource.create({
    data: {
      title: 'Sintel',
      description:
        'A lone warrior crosses deserts and mountains in search of the dragon she once rescued. A short epic about devotion, loss and what home means.',
      genre: 'Animation',
      year: 2010,
      videoSourceType: 'YOUTUBE',
      sourceRef: 'eRsGyueVLvQ',
      pricingType: 'MEMBERSHIP',
      status: 'PUBLISHED',
      producerId: amara.id,
      viewCount: 76,
    },
  })
  const tos = await db.resource.create({
    data: {
      title: 'Tears of Steel',
      description:
        'In a future Amsterdam, a team of scientists must re-live a broken past to stop robot armies from erasing the city. Sci-fi on a shoestring, done with style.',
      genre: 'Sci-Fi',
      year: 2012,
      videoSourceType: 'YOUTUBE',
      sourceRef: 'R6MlUcmOul8',
      pricingType: 'PPV',
      priceCents: 399,
      discountPercent: 25,
      status: 'PUBLISHED',
      producerId: kwame.id,
      viewCount: 54,
    },
  })
  const bbb4k = await db.resource.create({
    data: {
      title: 'Big Buck Bunny — 4K Remaster',
      description:
        'The beloved open movie, re-released in 60fps 4K. Same bunny, double the fluff — a perfect way to test how good your screen really is.',
      genre: 'Animation',
      year: 2013,
      videoSourceType: 'YOUTUBE',
      sourceRef: 'aqz-KE-bpKQ',
      pricingType: 'PPV',
      priceCents: 299,
      status: 'PUBLISHED',
      producerId: amara.id,
      viewCount: 31,
    },
  })
  const pending1 = await db.resource.create({
    data: {
      title: 'Golden Hour: A Lagos Story',
      description:
        'Street photographers, danfo drivers and a soundtrack of generators — a documentary portrait of Lagos at sunset. Submitted for approval.',
      genre: 'Documentary',
      year: 2024,
      videoSourceType: 'YOUTUBE',
      sourceRef: 'YE7VzlLtp-4',
      posterUrl: 'https://i.ytimg.com/vi/eRsGyueVLvQ/hqdefault.jpg',
      pricingType: 'PPV',
      priceCents: 499,
      discountPercent: 20,
      status: 'PENDING_REVIEW',
      producerId: kwame.id,
    },
  })
  await db.resource.create({
    data: {
      title: 'The Kite and the Shore',
      description:
        'Two siblings build a kite from their grandfather’s letters and fly it over the coast road. A family short about things that outlast people.',
      genre: 'Family',
      year: 2024,
      videoSourceType: 'YOUTUBE',
      sourceRef: 'eRsGyueVLvQ',
      pricingType: 'MEMBERSHIP',
      status: 'PENDING_REVIEW',
      producerId: amara.id,
    },
  })
  const rejected = await db.resource.create({
    data: {
      title: 'Night Market (Rough Cut)',
      description: 'First assembly of the night market doc — audio needs a pass.',
      genre: 'Documentary',
      year: 2024,
      videoSourceType: 'YOUTUBE',
      sourceRef: 'R6MlUcmOul8',
      pricingType: 'PPV',
      priceCents: 299,
      status: 'REJECTED',
      rejectionReason: 'Audio clips from 03:20 onward and the poster is missing — please re-cut and resubmit.',
      producerId: kwame.id,
    },
  })
  await db.resource.create({
    data: {
      title: 'Summer Project (working title)',
      description: 'Notes, refs and a first interview. Not ready to submit.',
      genre: 'Drama',
      videoSourceType: 'YOUTUBE',
      sourceRef: 'YE7VzlLtp-4',
      pricingType: 'PPV',
      priceCents: 199,
      status: 'DRAFT',
      producerId: amara.id,
    },
  })

  // Maya owns Tears of Steel (25% off: 399 → 299) with the day-one ledger.
  const purchase = await db.purchase.create({
    data: {
      userId: maya.id,
      resourceId: tos.id,
      kind: 'PPV_LIFETIME',
      amountCents: 299,
      status: 'COMPLETED',
      provider: 'DEMO',
    },
  })
  await db.payoutEntry.create({
    data: { producerId: kwame.id, resourceId: tos.id, purchaseId: purchase.id, type: 'EARNED', amountCents: 209, status: 'PAYABLE' },
  })
  await db.payoutEntry.create({
    data: { resourceId: tos.id, purchaseId: purchase.id, type: 'PLATFORM_FEE', amountCents: 90, status: 'PAYABLE' },
  })

  // Maya is 35% into the 4K bunny.
  await db.viewingProgress.create({
    data: { userId: maya.id, resourceId: bbb4k.id, positionSeconds: 380, durationSeconds: 635 },
  })

  await db.auditLog.create({
    data: { actorId: admin.id, resourceId: tos.id, action: 'MODERATE_PUBLISHED', detail: 'Seed: approved after review' },
  })
  await db.auditLog.create({
    data: { actorId: admin.id, resourceId: rejected.id, action: 'MODERATE_REJECTED', detail: 'Seed: audio + poster issues' },
  })

  // Producer-curated playlists — ordered collections of published titles.
  await db.playlist.create({
    data: {
      title: 'Animation Favorites',
      description:
        'The animated side of the catalog — start with the classic bunny, end with the 4K remaster.',
      status: 'PUBLISHED',
      producerId: amara.id,
      items: {
        create: [
          { resourceId: bbb.id, position: 1 },
          { resourceId: sintel.id, position: 2 },
          { resourceId: bbb4k.id, position: 3 },
        ],
      },
    },
  })
  await db.playlist.create({
    data: {
      title: 'Sci-Fi Spotlight',
      description: 'One pick for now — more land here as new sci-fi titles clear review.',
      status: 'PUBLISHED',
      producerId: kwame.id,
      items: {
        create: [{ resourceId: tos.id, position: 1 }],
      },
    },
  })

  console.log('Seed complete:')
  console.log('  users: admin@demo.stream / producer@demo.stream / producer2@demo.stream / viewer@demo.stream / viewer2@demo.stream')
  console.log('  password for all: demo1234')
  console.log(`  resources: ${await db.resource.count()} (2 pending review, 1 rejected, 1 draft)`)
  console.log(`  playlists: ${await db.playlist.count()} (published, on the home rail)`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
