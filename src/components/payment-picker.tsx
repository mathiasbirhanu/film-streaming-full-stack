'use client'

import { PAYMENT_METHODS, type PaymentMethod } from '@/lib/payments-gateway'
import { cn } from '@/lib/utils'

// Shared Ethiopian payment method chooser (checkout dialogs, membership).
export function PaymentPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: PaymentMethod
  onChange: (m: PaymentMethod) => void
  disabled?: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Payment method">
      {PAYMENT_METHODS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={value === m.id}
          disabled={disabled}
          onClick={() => onChange(m.id)}
          className={cn(
            'rounded-lg border p-2.5 text-left transition disabled:opacity-60',
            value === m.id
              ? 'border-emerald-400/70 bg-emerald-500/10 ring-1 ring-emerald-400/50'
              : 'border-white/10 bg-white/5 hover:border-white/25',
          )}
        >
          <div className="flex items-center gap-2">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', m.accent)} />
            <span className="text-sm font-semibold">{m.label}</span>
          </div>
          <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{m.hint}</div>
        </button>
      ))}
    </div>
  )
}
