// ── Moderation workflow — resource lifecycle state machine ────────────
// DRAFT → PENDING_REVIEW → PUBLISHED → SUSPENDED, with REJECTED from review.
// Producers propose transitions; admins perform them. Edits to a PUBLISHED
// resource send it back to review (re-approval rule).
import type { ResourceStatus } from '@/lib/types'

export const TRANSITIONS: Record<ResourceStatus, ResourceStatus[]> = {
  DRAFT: ['PENDING_REVIEW', 'PUBLISHED'],
  PENDING_REVIEW: ['PUBLISHED', 'REJECTED'],
  PUBLISHED: ['SUSPENDED', 'PENDING_REVIEW'],
  REJECTED: ['PENDING_REVIEW', 'PUBLISHED'],
  SUSPENDED: ['PUBLISHED'],
}

export function canTransition(from: ResourceStatus, to: ResourceStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export const STATUS_LABEL: Record<ResourceStatus, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending review',
  PUBLISHED: 'Published',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
}
