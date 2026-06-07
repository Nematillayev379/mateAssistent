import crypto from 'crypto';
import { getRedisConnection } from '../services/redis';
import { logger } from '../utils/logger';

export interface Session {
  sid: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

const SESSION_KEY_PREFIX = 'rss:sess:';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const SESSION_TTL_MS = SESSION_TTL_SECONDS * 1000;
const SESSION_COOKIE = 'rss_sid';

function newSessionId(): string {
  return crypto.randomBytes(32).toString('hex');
}

function keyFor(sid: string): string {
  return SESSION_KEY_PREFIX + sid;
}

export async function createSession(userId: string | number): Promise<Session> {
  const sid = newSessionId();
  const now = Date.now();
  const session: Session = { sid, userId: String(userId), createdAt: now, expiresAt: now + SESSION_TTL_MS };
  const redis = await getRedisConnection();
  if (redis) {
    await redis.setEx(keyFor(sid), SESSION_TTL_SECONDS, JSON.stringify(session));
  } else {
    logger.warn('Session created without Redis - will not persist across restarts');
  }
  return session;
}

export function setSessionCookie(res: any, sid: string): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

export function clearSessionCookie(res: any): void {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

export async function readSessionUserId(req: any): Promise<string | null> {
  const cookieHeader: string = req.headers?.cookie || '';
  const m = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!m) return null;
  const sid = m[1];
  const redis = await getRedisConnection();
  if (!redis) return null;
  const raw = await redis.get(keyFor(sid));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    if (Date.now() > session.expiresAt) {
      await redis.del(keyFor(sid));
      return null;
    }
    return session.userId;
  } catch {
    return null;
  }
}

export async function destroySession(req: any): Promise<void> {
  const cookieHeader: string = req.headers?.cookie || '';
  const m = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!m) return;
  const redis = await getRedisConnection();
  if (redis) await redis.del(keyFor(m[1]));
}
