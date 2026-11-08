// ── Payment gateway seam — Ethiopian rails first ────────────────────
// Every charge funnels through authorizeCharge(). Today it simulates
// authorization (demo). Wiring a live provider = implementing the call
// per method (telebirr SSA API, CBE Birr gateway, Chapa PaymentInitiate,
// Stripe PaymentIntents for cards) — catalog, entitlements and the
// ledger never move.

export type PaymentMethod = 'TELEBIRR' | 'CBE_BIRR' | 'CHAPA' | 'CARD'

export interface PaymentMethodDef {
  id: PaymentMethod
  label: string
  hint: string
  accent: string
}

export const PAYMENT_METHODS: PaymentMethodDef[] = [
  { id: 'TELEBIRR', label: 'telebirr', hint: 'Ethio Telecom mobile money', accent: 'bg-emerald-500' },
  { id: 'CBE_BIRR', label: 'CBE Birr', hint: 'Commercial Bank of Ethiopia', accent: 'bg-purple-500' },
  { id: 'CHAPA', label: 'Chapa', hint: 'Local banks & wallets via Chapa', accent: 'bg-amber-500' },
  { id: 'CARD', label: 'Card', hint: 'Visa / Mastercard (diaspora)', accent: 'bg-sky-500' },
]

export function isPaymentMethod(v: string): v is PaymentMethod {
  return PAYMENT_METHODS.some((m) => m.id === v)
}

// Demo FX configuration — replace with a live FX feed at integration.
export const ETB_PER_USD = 132

export function etbFromCents(cents: number): string {
  return Math.round((cents / 100) * ETB_PER_USD).toLocaleString('en-US')
}

export interface ChargeResult {
  provider: PaymentMethod
  providerRef: string
}

const REF_PREFIX: Record<PaymentMethod, string> = {
  TELEBIRR: 'tb_',
  CBE_BIRR: 'cbe_',
  CHAPA: 'chp_',
  CARD: 'crd_',
}

export async function authorizeCharge(
  amountCents: number,
  method: PaymentMethod,
  description: string,
): Promise<ChargeResult> {
  // Simulated authorization latency so the checkout UX matches the real thing.
  void description
  await new Promise((r) => setTimeout(r, 1200))
  const ref = `${REF_PREFIX[method]}${crypto.randomUUID().slice(0, 12)}`
  return { provider: method, providerRef: ref }
}
