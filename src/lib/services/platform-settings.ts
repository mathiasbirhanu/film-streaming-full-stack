// ── Platform settings service (admin-configurable runtime config) ────
// Reads/writes the Setting key/value table. The producer revenue share
// is stored in basis points (7000 = 70.00%) — integer math, no float
// drift. Every purchase snapshots the share at charge time, so changing
// the percentage only affects FUTURE sales; the ledger keeps the split
// each sale actually happened under.
import { db } from '@/lib/db'

export const SHARE_KEY = 'producerShareBps'
export const DEFAULT_PRODUCER_SHARE_BPS = 7000 // 70% producer / 30% platform

// Guardrails: producers are never squeezed below 10%, and the platform
// always keeps at least 5% to cover operating costs.
const MIN_BPS = 1000
const MAX_BPS = 9500

export function clampShareBps(bps: number): number {
  if (!Number.isFinite(bps)) return DEFAULT_PRODUCER_SHARE_BPS
  return Math.min(MAX_BPS, Math.max(MIN_BPS, Math.round(bps)))
}

export function bpsToPercent(bps: number): number {
  return Math.round(bps) / 100
}

export async function getProducerShareBps(): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: SHARE_KEY } })
  if (!row) return DEFAULT_PRODUCER_SHARE_BPS
  const v = Number.parseInt(row.value, 10)
  return Number.isFinite(v) ? clampShareBps(v) : DEFAULT_PRODUCER_SHARE_BPS
}

export async function setProducerShareBps(bps: number): Promise<number> {
  const v = clampShareBps(bps)
  await db.setting.upsert({
    where: { key: SHARE_KEY },
    create: { key: SHARE_KEY, value: String(v) },
    update: { value: String(v) },
  })
  return v
}
