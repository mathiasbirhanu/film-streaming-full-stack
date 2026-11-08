import { createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { db } from '@/lib/db'
import type { Role, SessionUser } from '@/lib/types'

// HMAC-signed stateless session cookie (httpOnly). This is the equivalent of
// a .NET authentication handler issuing a protected cookie/JWT.

const COOKIE_NAME = 'sr_session'
const SECRET = process.env.AUTH_SECRET ?? 'streamroots-dev-secret-change-me'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url')
}

function createToken(userId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + MAX_AGE_SECONDS * 1000 })
  ).toString('base64url')
  return `${payload}.${sign(payload)}`
}

function readToken(token: string | undefined): string | null {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = sign(payload)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      uid: string
      exp: number
    }
    if (!data.uid || Date.now() > data.exp) return null
    return data.uid
  } catch {
    return null
  }
}

export async function startSession(userId: string): Promise<void> {
  const store = await cookies()
  store.set(COOKIE_NAME, createToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    // HTTPS-only outside local dev so the session cookie never travels
    // over an unencrypted hop in production.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  })
}

export async function endSession(): Promise<void> {
  const store = await cookies()
  store.delete(COOKIE_NAME)
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies()
  const uid = readToken(store.get(COOKIE_NAME)?.value)
  if (!uid) return null
  const user = await db.user.findUnique({
    where: { id: uid },
    select: { id: true, email: true, name: true, role: true },
  })
  if (!user) return null
  return { ...user, role: user.role as Role }
}
