'use server'

import { db } from '@/lib/db'
import { hashPassword, verifyPassword } from '@/lib/password'
import { endSession, getSessionUser, startSession } from '@/lib/session'
import { membershipIsActive } from '@/lib/services/entitlement'
import type { ActionResult, MembershipSummary, Role, SessionUser } from '@/lib/types'

function safeUser(u: { id: string; email: string; name: string; role: string }): SessionUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role as Role }
}

async function membershipSummary(userId: string): Promise<MembershipSummary> {
  const m = await db.membership.findFirst({
    where: { userId },
    orderBy: { startedAt: 'desc' },
  })
  const active = membershipIsActive(m)
  return {
    active,
    status: m ? (active ? 'ACTIVE' : m.status) : 'NONE',
    expiresAt: m ? m.expiresAt.toISOString() : null,
    provider: m ? m.provider : null,
  }
}

export async function register(input: {
  name: string
  email: string
  password: string
  role?: 'VIEWER' | 'PRODUCER'
}): Promise<ActionResult<{ user: SessionUser; membership: MembershipSummary }>> {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (name.length < 2) return { ok: false, error: 'Please enter your full name.' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return { ok: false, error: 'Please enter a valid email address.' }
  if (input.password.length < 8)
    return { ok: false, error: 'Password must be at least 8 characters.' }

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) return { ok: false, error: 'An account with this email already exists.' }

  const role: Role = input.role === 'PRODUCER' ? 'PRODUCER' : 'VIEWER'
  const user = await db.user.create({
    data: { name, email, passwordHash: hashPassword(input.password), role },
  })
  await startSession(user.id)
  return {
    ok: true,
    data: { user: safeUser(user), membership: await membershipSummary(user.id) },
  }
}

export async function login(input: {
  email: string
  password: string
}): Promise<ActionResult<{ user: SessionUser; membership: MembershipSummary }>> {
  const email = input.email.trim().toLowerCase()
  const user = await db.user.findUnique({ where: { email } })
  if (!user || !verifyPassword(input.password, user.passwordHash))
    return { ok: false, error: 'Invalid email or password.' }
  await startSession(user.id)
  return {
    ok: true,
    data: { user: safeUser(user), membership: await membershipSummary(user.id) },
  }
}

export async function logout(): Promise<ActionResult> {
  await endSession()
  return { ok: true }
}

export async function me(): Promise<{
  user: SessionUser | null
  membership: MembershipSummary
}> {
  const user = await getSessionUser()
  if (!user) return { user: null, membership: { active: false, status: 'NONE', expiresAt: null, provider: null } }
  return { user, membership: await membershipSummary(user.id) }
}
