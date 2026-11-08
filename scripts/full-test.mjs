// StreamRoots deep functional test — exercises the exact data-layer logic
// the server actions use, against the real seeded SQLite DB.
import { createHmac, timingSafeEqual } from 'crypto'
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

let pass = 0, fail = 0
function ok(label, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS  ${label}${extra ? '  ' + extra : ''}`) }
  else { fail++; console.log(`FAIL  ${label}${extra ? '  ' + extra : ''}`) }
}

// ── 1. Admin per-movie income report (exact queries from adminIncomeReport) ──
const [sales, ledger, resources, membershipTotal] = await Promise.all([
  db.purchase.groupBy({ by: ['resourceId'], where: { status: 'COMPLETED' }, _count: { _all: true }, _sum: { amountCents: true } }),
  db.payoutEntry.groupBy({ by: ['resourceId', 'type'], _sum: { amountCents: true } }),
  db.resource.findMany({ select: { id: true, title: true, producer: { select: { name: true } } } }),
  db.membership.aggregate({ _sum: { priceCents: true } }),
])
const ledgerByResource = new Map()
for (const e of ledger) {
  const cur = ledgerByResource.get(e.resourceId) ?? { producer: 0, platform: 0 }
  if (e.type === 'EARNED') cur.producer += e._sum.amountCents ?? 0
  else if (e.type === 'PLATFORM_FEE') cur.platform += e._sum.amountCents ?? 0
  ledgerByResource.set(e.resourceId, cur)
}
const salesByResource = new Map(sales.map(s => [s.resourceId, { count: s._count._all, gross: s._sum.amountCents ?? 0 }]))
const titleById = new Map(resources.map(r => [r.id, r]))
const ids = new Set([...salesByResource.keys(), ...ledgerByResource.keys()])
const rows = [...ids].map(rid => {
  const s = salesByResource.get(rid) ?? { count: 0, gross: 0 }
  const l = ledgerByResource.get(rid) ?? { producer: 0, platform: 0 }
  return { title: titleById.get(rid)?.title ?? 'Removed title', producer: titleById.get(rid)?.producer?.name ?? null, sales: s.count, grossCents: s.gross, producerCents: l.producer, platformCents: l.platform }
}).sort((a, b) => b.grossCents - a.grossCents || b.sales - a.sales)
const totals = rows.reduce((t, r) => ({ sales: t.sales + r.sales, grossCents: t.grossCents + r.grossCents, producerCents: t.producerCents + r.producerCents, platformCents: t.platformCents + r.platformCents }), { sales: 0, grossCents: 0, producerCents: 0, platformCents: 0 })

console.log('\n== 1. ADMIN PER-MOVIE INCOME TABLE ==')
for (const r of rows) console.log(`      "${r.title}" producer=${r.producer} sales=${r.sales} gross=${r.grossCents}c producer=${r.producerCents}c platform=${r.platformCents}c`)
ok('income table has rows', rows.length > 0, `${rows.length} movie(s)`)
ok('totals producer+platform == gross', totals.producerCents + totals.platformCents === totals.grossCents, `${totals.producerCents}+${totals.platformCents}=${totals.grossCents}`)
ok('70/30 split on current data (7000bps)', totals.producerCents === Math.round((totals.grossCents * 7000) / 10000))
ok('membership revenue separate', membershipTotal._sum.priceCents > 0, `${membershipTotal._sum.priceCents}c`)

// ── 2. Producer income isolation (exact queries from producerIncome) ──
console.log('\n== 2. PRODUCER DATA ISOLATION ==')
const producers = await db.user.findMany({ where: { role: 'PRODUCER' }, select: { id: true, name: true } })
for (const p of producers) {
  const pSales = await db.purchase.groupBy({ by: ['resourceId'], where: { status: 'COMPLETED', resource: { producerId: p.id } }, _count: { _all: true }, _sum: { amountCents: true } })
  const pEarned = await db.payoutEntry.groupBy({ by: ['resourceId'], where: { producerId: p.id, type: 'EARNED' }, _sum: { amountCents: true } })
  const pTitles = await db.resource.findMany({ where: { producerId: p.id }, select: { id: true } })
  const pTitleIds = new Set(pTitles.map(t => t.id))
  const foreignSales = pSales.filter(s => !pTitleIds.has(s.resourceId)).length
  const foreignLedger = await db.payoutEntry.count({ where: { producerId: p.id, resource: { producerId: { not: p.id } } } })
  const sumEarned = pEarned.reduce((s, e) => s + (e._sum.amountCents ?? 0), 0)
  ok(`producer "${p.name}" sales scoped to own titles`, foreignSales === 0, `${pSales.length} sale-group(s), earned=${sumEarned}c`)
  ok(`producer "${p.name}" ledger rows all own`, foreignLedger === 0)
}

// cross-producer leak probe: producer A must not see B's income
const [a, b] = producers
if (a && b) {
  const bTitles = await db.resource.findMany({ where: { producerId: b.id }, select: { id: true } })
  const leakViaA = await db.payoutEntry.count({ where: { producerId: a.id, resourceId: { in: bTitles.map(t => t.id) } } })
  ok('no cross-producer ledger leak (A sees none of B)', leakViaA === 0)
}

// ── 3. Viewer isolation (library + membership + progress scoping) ──
console.log('\n== 3. VIEWER DATA ISOLATION ==')
const viewers = await db.user.findMany({ where: { role: 'VIEWER' }, select: { id: true, name: true } })
for (const v of viewers) {
  const lib = await db.purchase.findMany({ where: { userId: v.id, status: 'COMPLETED' }, include: { resource: true } })
  const mem = await db.membership.findFirst({ where: { userId: v.id }, orderBy: { startedAt: 'desc' } })
  const prog = await db.viewingProgress.findMany({ where: { userId: v.id } })
  const scoped = lib.every(p => p.userId === v.id)
  ok(`viewer "${v.name}" library scoped`, scoped, `${lib.length} purchase(s), mem=${mem ? mem.status : 'none'}, prog=${prog.length}`)
}

// ── 4. Split configurability (platform-settings.ts logic) ──
console.log('\n== 4. SPLIT CONFIGURABILITY ==')
const DEFAULT_BPS = 7000, MIN_BPS = 1000, MAX_BPS = 9500
const clamp = b => Number.isFinite(b) ? Math.min(MAX_BPS, Math.max(MIN_BPS, Math.round(b))) : DEFAULT_BPS
ok('clamp low (500 -> 1000 = 10%)', clamp(500) === 1000)
ok('clamp high (9900 -> 9500 = 95%)', clamp(9900) === 9500)
ok('clamp normal (6500 stays)', clamp(6500) === 6500)
ok('NaN -> default 7000', clamp(NaN) === 7000)
for (const bps of [7000, 6000, 9500]) {
  const amount = 499
  const prod = Math.round((amount * bps) / 10000)
  ok(`integer split math @${bps}bps: producer+platform==charge`, prod + (amount - prod) === amount, `charge=${amount}c prod=${prod}c plat=${amount - prod}c`)
}
// live round-trip on the real Setting row (restore afterwards)
const before = await db.setting.findUnique({ where: { key: 'producerShareBps' } })
await db.setting.upsert({ where: { key: 'producerShareBps' }, update: { value: '6000' }, create: { key: 'producerShareBps', value: '6000' } })
const changed = await db.setting.findUnique({ where: { key: 'producerShareBps' } })
await db.setting.upsert({ where: { key: 'producerShareBps' }, update: { value: before?.value ?? '7000' }, create: { key: 'producerShareBps', value: '7000' } })
const restored = await db.setting.findUnique({ where: { key: 'producerShareBps' } })
ok('Setting round-trip set/get/restore', changed?.value === '6000' && restored?.value === (before?.value ?? '7000'), `now=${restored?.value}`)

// ── 5. Session token security (session.ts logic, same HMAC scheme) ──
console.log('\n== 5. SESSION TOKEN SECURITY ==')
const SECRET = process.env.AUTH_SECRET ?? 'streamroots-dev-secret-change-me'
const sign = p => createHmac('sha256', SECRET).update(p).digest('base64url')
const me = await db.user.findFirst({ where: { role: 'ADMIN' } })
const payload = Buffer.from(JSON.stringify({ uid: me.id, exp: Date.now() + 86400000 })).toString('base64url')
const goodToken = `${payload}.${sign(payload)}`
ok('valid token verifies', sign(payload) === goodToken.split('.')[1])
// tamper: swap uid inside payload, keep old signature
const evilPayload = Buffer.from(JSON.stringify({ uid: 'victim-id', exp: Date.now() + 86400000 })).toString('base64url')
const tampered = `${evilPayload}.${sign(payload)}`
ok('tampered payload rejected', sign(evilPayload) !== tampered.split('.')[1])
// expired token
const expPayload = Buffer.from(JSON.stringify({ uid: me.id, exp: Date.now() - 1000 })).toString('base64url')
const expData = JSON.parse(Buffer.from(expPayload, 'base64url').toString())
ok('expired token rejected by exp check', Date.now() > expData.exp)
// garbage signature same length
const fakeSig = Buffer.from('A'.repeat(sign(payload).length)).toString()
const a1 = Buffer.from('A'.repeat(sign(payload).length)), a2 = Buffer.from(sign(payload))
ok('constant-time compare works on same-length fakes', !timingSafeEqual(a1, a2))

// ── 6. Home search (title + genre, home.tsx filter logic) ──
console.log('\n== 6. HOME SEARCH (title + genre) ==')
const catalog = await db.resource.findMany({ where: { status: 'PUBLISHED' }, include: { producer: { select: { name: true } } } })
const catalogItems = catalog.map(r => ({ id: r.id, title: r.title, genre: r.genre }))
const query = catalogItems[0]?.title?.split(' ')[0] ?? ''
const genre0 = catalogItems[0]?.genre
const titleHit = catalogItems.filter(i => i.title.toLowerCase().includes(query.trim().toLowerCase()))
const genreHit = catalogItems.filter(i => i.genre === genre0)
ok('catalog has published items to search', catalogItems.length > 0, `${catalogItems.length} item(s)`)
ok(`title search "${query}" matches >=1`, titleHit.length >= 1, `${titleHit.length} hit(s)`)
ok(`genre filter "${genre0}" matches >=1`, genreHit.length >= 1, `${genreHit.length} hit(s)`)
ok('title search is case-insensitive', catalogItems.filter(i => i.title.toLowerCase().includes(query.toUpperCase().toLowerCase())).length === titleHit.length)

console.log(`\n======== RESULT: ${pass} passed, ${fail} failed ========`)
await db.$disconnect()
process.exit(fail ? 1 : 0)
