// Cross-implementation parity: TS (current app) vs .NET API (new backend).
// A cookie minted by one side must verify on the other; a hash minted by
// one side must verify on the other; catalog + income JSON must match.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto'

const API = 'http://127.0.0.1:5080'
const SECRET = 'streamroots-dev-secret-change-me'
let pass = 0, fail = 0
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; console.log(`PASS  ${label}${extra ? '  ' + extra : ''}`) }
  else { fail++; console.log(`FAIL  ${label}${extra ? '  ' + extra : ''}`) }
}

// ── 1. Token parity ─────────────────────────────────────────────────
// TS mints → .NET verifies (via /api/auth/me with Bearer)
const me = await (await fetch('http://127.0.0.1:3000/api')).text() // warm
const ADMIN_UID_RES = await fetch(API + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@demo.stream', password: 'demo1234' }),
})
const adminCookie = (ADMIN_UID_RES.headers.getSetCookie?.() ?? [''])[0].split(';')[0]
const adminUid = (await ADMIN_UID_RES.json()).data?.id ?? ''

// Extract .NET-minted token; re-sign same payload with TS logic must verify identically
const netToken = adminCookie.split('=').slice(1).join('=')
const tsSign = p => createHmac('sha256', SECRET).update(p).digest('base64url')
const [payload, sig] = netToken.split('.')
ok('.NET token signature == TS HMAC over same payload', tsSign(payload) === sig)

// TS mints → .NET verifies
const tsToken = `${Buffer.from(JSON.stringify({ uid: adminUid, exp: Date.now() + 86400000 })).toString('base64url')}.${tsSign(Buffer.from(JSON.stringify({ uid: adminUid, exp: Date.now() + 86400000 })).toString('base64url'))}`
const meRes = await fetch(API + '/api/auth/me', { headers: { Authorization: `Bearer ${tsToken}` } })
const meJson = await meRes.json()
ok('TS-minted token accepted by .NET /me', meJson.ok === true, JSON.stringify(meJson.data ?? meJson.error))

// ── 2. scrypt parity (reverse direction: .NET hash → TS verify) ─────
// .NET hashes a fresh password via /register; TS verifyPassword must accept it.
const freshEmail = `parity-${randomBytes(4).toString('hex')}@test.stream`
const reg = await fetch(API + '/api/auth/register', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: freshEmail, password: 'parity-pass-1', name: 'Parity Bot' }),
})
ok('.NET register ok', (await reg.json()).ok === true)
const pg = await (await fetch(API + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: freshEmail, password: 'parity-pass-1' }),
})).json()
ok('.NET hash verifies on .NET login', pg.ok === true)
// verify the stored scrypt hash with Node's scryptSync
import pgPkg from 'pg'
const pgc = new pgPkg.Client({ connectionString: 'postgresql://streamroots@127.0.0.1:5433/streamroots' })
await pgc.connect()
const { rows } = await pgc.query('SELECT "passwordHash" FROM "User" WHERE email=$1', [freshEmail])
const [saltHex, hashHex] = rows[0].passwordHash.split(':')
const candidate = scryptSync('parity-pass-1', saltHex, 64)
const expected = Buffer.from(hashHex, 'hex')
ok('.NET scrypt hash verified by Node scryptSync', candidate.equals(expected))
// negative: wrong password must fail on Node too
const wrong = scryptSync('wrong-password', saltHex, 64)
ok('wrong password rejected on Node side', !wrong.equals(expected))
await pgc.end()

// ── 3. Catalog parity: TS actions vs .NET API, same DB ──────────────
// (TS getCatalog logic replicated exactly — the action code cannot run
// outside a request context, the queries are the contract)
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const tsRows = await db.resource.findMany({
  where: { status: 'PUBLISHED' }, include: { producer: { select: { name: true } } },
  orderBy: { createdAt: 'desc' },
})
const tsCatalog = tsRows.map(r => {
  const active = r.discountPercent > 0 && (!r.discountEndsAt || new Date(r.discountEndsAt).getTime() > Date.now())
  const eff = active ? Math.max(0, Math.round((r.priceCents * (100 - r.discountPercent)) / 100)) : r.priceCents
  return { id: r.id, title: r.title, genre: r.genre, effectivePriceCents: eff, producerName: r.producer?.name ?? null, viewCount: r.viewCount }
})
const netCatalog = (await (await fetch(API + '/api/catalog')).json())
  .map(i => ({ id: i.id, title: i.title, genre: i.genre, effectivePriceCents: i.effectivePriceCents, producerName: i.producerName, viewCount: i.viewCount }))
ok('catalog identical (id/title/genre/price/producer/views)', JSON.stringify(tsCatalog) === JSON.stringify(netCatalog),
  `${netCatalog.length} items`)

// ── 4. Income report parity ─────────────────────────────────────────
const ledger = await db.payoutEntry.groupBy({ by: ['resourceId', 'type'], _sum: { amountCents: true } })
const lp = ledger.filter(e => e.type === 'EARNED').reduce((s, e) => s + (e._sum.amountCents ?? 0), 0)
const lf = ledger.filter(e => e.type === 'PLATFORM_FEE').reduce((s, e) => s + (e._sum.amountCents ?? 0), 0)
const inc = (await (await fetch(API + '/api/admin/income', { headers: { Authorization: `Bearer ${tsToken}` } })).json()).data
if (!inc) { console.log('FAIL  income response missing data'); process.exit(1) }
ok('income totals == TS ledger sums', inc.totals.producerCents === lp && inc.totals.platformCents === lf,
  `net ${inc.totals.producerCents}+${inc.totals.platformCents} vs ts ${lp}+${lf}`)
ok('income producer+platform == gross', inc.totals.producerCents + inc.totals.platformCents === inc.totals.grossCents)

await db.$disconnect()
console.log(`\n======== PARITY: ${pass} passed, ${fail} failed ========`)
process.exit(fail ? 1 : 0)
