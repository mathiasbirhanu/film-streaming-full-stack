// Quick DB sanity check with real model names from schema.prisma
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();

async function main() {
  const users = await db.user.findMany({ select: { role: true } });
  const byRole = {};
  for (const u of users) byRole[u.role] = (byRole[u.role] || 0) + 1;
  console.log('users:', users.length, JSON.stringify(byRole));

  const resources = await db.resource.count();
  const byStatus = await db.resource.groupBy({ by: ['status'], _count: true });
  console.log('resources:', resources, byStatus.map(s => `${s.status}:${s._count}`).join(', '));

  const byGenre = await db.resource.groupBy({ by: ['genre'], _count: true });
  console.log('genres:', byGenre.map(g => `${g.genre}:${g._count}`).join(', '));

  for (const t of ['purchase', 'membership', 'payoutEntry', 'playlist', 'setting', 'notification', 'auditLog', 'viewingProgress']) {
    try { console.log(`${t}:`, await db[t].count()); }
    catch { console.log(`${t}: ERROR`); }
  }

  const settings = await db.setting.findMany();
  console.log('setting rows:', JSON.stringify(settings));

  const led = await db.payoutEntry.groupBy({ by: ['type'], _count: true, _sum: { amountCents: true } });
  console.log('payoutEntry summary:', led.map(l => `${l.type}:n=${l._count} sum=${l._sum.amountCents}`).join(', '));
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); }).finally(() => db.$disconnect());
