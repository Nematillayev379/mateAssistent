import IORedis, { RedisOptions } from 'ioredis';
import { EventEmitter } from 'events';
import { CONFIG } from '../config/config';
import { logger } from '../utils/logger';

export interface RedisRuntimeConnection {
  readonly status: string;
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
}

// ─── In-memory fallback ─────────────────────────────────────

let memoryConnection: RedisRuntimeConnection | null = null;

function getMemoryConnection(): RedisRuntimeConnection {
  if (memoryConnection) return memoryConnection;
  const store = new Map<string, { value: string; expiresAt: number }>();
  const ttlTimers = new Map<string, NodeJS.Timeout>();
  memoryConnection = {
    status: 'ready',
    async ping() { return 'PONG'; },
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
      return entry.value ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, { value, expiresAt: Infinity });
      return 'OK';
    },
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) {
        if (store.delete(key)) removed += 1;
        const t = ttlTimers.get(key);
        if (t) { clearTimeout(t); ttlTimers.delete(key); }
      }
      return removed;
    },
    async incr(key: string) {
      const entry = store.get(key);
      if (!entry || Date.now() > entry.expiresAt) {
        store.set(key, { value: '1', expiresAt: Infinity });
        return 1;
      }
      const next = parseInt(entry.value, 10) + 1;
      entry.value = String(next);
      return next;
    },
    async pexpire(key: string, ms: number) {
      const entry = store.get(key);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + ms;
      const existing = ttlTimers.get(key);
      if (existing) clearTimeout(existing);
      ttlTimers.set(key, setTimeout(() => { store.delete(key); ttlTimers.delete(key); }, ms));
      return 1;
    },
  };
  return memoryConnection;
}

// ─── Parse multiple Redis URLs ─────────────────────────────

function parseRedisUrls(): string[] {
  const urls: string[] = [];
  const allowLocalRedis = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';

  function pushUrl(rawUrl: string, source: string) {
    const t = rawUrl.trim();
    if (!t) return;
    const isLocal = /localhost|127\.0\.0\.1/i.test(t);
    if (isLocal && !allowLocalRedis) {
      logger.warn(`Skipping local Redis URL from ${source} in production: ${t.replace(/:[^:@/]+@/, ':***@')}`);
      return;
    }
    urls.push(t);
  }

  if (CONFIG.REDIS_URLS && CONFIG.REDIS_URLS.trim()) {
    for (const u of CONFIG.REDIS_URLS.split(',')) {
      pushUrl(u, 'REDIS_URLS');
    }
  }
  if (CONFIG.REDIS_URL && CONFIG.REDIS_URL.trim()) {
    const existing = new Set(urls);
    const normalized = CONFIG.REDIS_URL.trim();
    if (!existing.has(normalized)) {
      const isLocal = /localhost|127\.0\.0\.1/i.test(normalized);
      if (isLocal && !allowLocalRedis) {
        logger.warn(`Skipping local REDIS_URL in production: ${normalized.replace(/:[^:@/]+@/, ':***@')}`);
      } else {
        urls.unshift(normalized);
      }
    }
  }
  if (!urls.length && CONFIG.DEFAULT_REDIS_URL && CONFIG.DEFAULT_REDIS_URL.trim()) {
    const defaultUrl = CONFIG.DEFAULT_REDIS_URL.trim();
    const isLocalDefault = /localhost|127\.0\.0\.1/i.test(defaultUrl);
    if (!isLocalDefault || process.env.NODE_ENV === 'development') {
      urls.push(defaultUrl);
    }
  }
  return urls;
}

// ─── Connection pool ───────────────────────────────────────

interface PoolEntry {
  url: string;
  exhausted: boolean;
  conn: IORedis | null;
}

class RedisPool {
  readonly entries: PoolEntry[] = [];
  private currentIndex = 0;

  constructor(urls: string[]) {
    this.entries = urls.map(url => ({ url, exhausted: false, conn: null }));
  }

  get active(): IORedis {
    const entry = this.entries[this.currentIndex];
    if (!entry.conn) {
      entry.conn = this.createConnection(entry.url);
    }
    return entry.conn;
  }

  get status(): string {
    return this.active.status;
  }

  hasAvailable(): boolean {
    return this.entries.some(e => !e.exhausted);
  }

  get activeUrl(): string {
    return this.entries[this.currentIndex]?.url || '(none)';
  }

  get exhaustedCount(): number {
    return this.entries.filter(e => e.exhausted).length;
  }

  get totalCount(): number {
    return this.entries.length;
  }

  /** Mark current token as exhausted and rotate. Returns false if all exhausted. */
  markExhausted(): boolean {
    const oldEntry = this.entries[this.currentIndex];
    oldEntry.exhausted = true;
    logger.warn(`Redis token exhausted: ${this.maskUrl(oldEntry.url)}`);

    if (oldEntry.conn) {
      try { oldEntry.conn.disconnect(); } catch { /* ignore */ }
      oldEntry.conn = null;
    }

    for (let i = 0; i < this.entries.length; i++) {
      const idx = (this.currentIndex + 1 + i) % this.entries.length;
      if (!this.entries[idx].exhausted) {
        this.currentIndex = idx;
        logger.info(`Rotated to Redis token #${idx + 1}/${this.entries.length}: ${this.maskUrl(this.entries[idx].url)}`);
        return true;
      }
    }

    logger.error('All Redis tokens exhausted! Falling back to in-memory.');
    return false;
  }

  private createConnection(url: string): IORedis {
    return new IORedis(url, {
      lazyConnect: true,
      connectTimeout: 10000,
      maxRetriesPerRequest: null,

      retryStrategy: (times: number) => {
        if (times > 3) {
          logger.error(`Redis connection failed after 3 retries: ${this.maskUrl(url)}`);
          return null;
        }
        return Math.min(times * 1000, 3000);
      },
    });
  }

  private maskUrl(url: string): string {
    try {
      const u = new URL(url);
      if (u.password) u.password = '***';
      return u.toString();
    } catch {
      return url.length > 20 ? url.slice(0, 10) + '...' + url.slice(-10) : url;
    }
  }

  /** Close all connections */
  async shutdown(): Promise<void> {
    for (const entry of this.entries) {
      if (entry.conn) {
        try { await entry.conn.quit(); } catch { /* ignore */ }
        entry.conn = null;
      }
    }
  }
}

// ─── Pool-aware ioredis wrapper for BullMQ ─────────────────
// Uses Proxy to intercept all calls; the proxied target is an IORedis
// instance so BullMQ's `instanceof IORedis` check passes.

function createPooledIORedis(pool: RedisPool): IORedis {
  const registered = new Map<string, Set<(...args: any[]) => void>>();
  const ee = new EventEmitter();

  let currentConn = pool.active;
  attachPoolListeners(currentConn);

  function attachPoolListeners(conn: IORedis): void {
    conn.on('error', (err: Error) => handleError(err, conn));
    conn.on('connect', () => ee.emit('connect'));
    conn.on('close', () => ee.emit('close'));
  }

  function handleError(err: Error, _conn: IORedis): void {
    const isLimit = err.message?.includes('limit exceeded') || err.message?.toLowerCase().includes('exceeded');
    if (isLimit) {
      if (pool.markExhausted()) {
        currentConn = pool.active;
        attachPoolListeners(currentConn);
        for (const [event, handlers] of registered) {
          for (const h of handlers) currentConn.on(event, h);
        }
        logger.info('Rotated to next Redis token');
      }
      return;
    }
    ee.emit('error', err);
  }

  async function execCmd<T>(fn: (c: IORedis) => Promise<T>): Promise<T> {
    try {
      return await fn(currentConn);
    } catch (err: any) {
      if (err.message?.includes('limit exceeded') || err.message?.toLowerCase().includes('exceeded')) {
        if (pool.markExhausted()) {
          currentConn = pool.active;
          attachPoolListeners(currentConn);
          for (const [event, handlers] of registered) {
            for (const h of handlers) currentConn.on(event, h);
          }
          return fn(currentConn);
        }
      }
      throw err;
    }
  }

  const eventMethods = new Set([
    'setMaxListeners', 'getMaxListeners', 'eventNames', 'listeners', 'rawListeners',
    'prependListener', 'prependOnceListener', 'addListener', 'listenerCount'
  ]);

  // Create a dummy IORedis instance as Proxy target (passes instanceof)
  const dummy = new IORedis({ host: '127.0.0.1', port: 6379, lazyConnect: true, maxRetriesPerRequest: null });
  dummy.disconnect();

  const proxy = new Proxy(dummy, {
    get(target, prop) {
      const currentValue = (currentConn as any)[prop];
      const targetValue = (target as any)[prop];
      // EventEmitter methods -> delegate to ee (local EventEmitter)
      if (typeof prop === 'string' && eventMethods.has(prop)) {
        return (ee as any)[prop].bind(ee);
      }

      if (prop === 'status') return currentConn.status;
      if (prop === 'connect') return async () => { if (currentConn.status !== 'ready') await currentConn.connect(); };
      if (prop === 'disconnect') return async () => { try { await currentConn.disconnect(); } catch {} };
      if (prop === 'quit') return async () => { for (const e of pool.entries) { if (e.conn) { try { await e.conn.quit(); } catch {} e.conn = null; } } };
      if (prop === 'duplicate') return () => proxy;

      // Event listener registration -> track and delegate to currentConn
      if (prop === 'on') return (event: string, handler: (...a: any[]) => void) => {
        if (!registered.has(event)) registered.set(event, new Set());
        registered.get(event)!.add(handler);
        currentConn.on(event, handler);
        return proxy;
      };
      if (prop === 'off' || prop === 'removeListener') return (event: string, handler: (...a: any[]) => void) => {
        registered.get(event)?.delete(handler);
        currentConn.off(event, handler);
        return proxy;
      };
      if (prop === 'removeAllListeners') return (event?: string) => {
        if (event) registered.delete(event); else registered.clear();
        currentConn.removeAllListeners(event);
        return proxy;
      };
      if (prop === 'emit') return (event: string, ...args: any[]) => ee.emit(event, ...args);
      if (prop === 'listenerCount') return (event?: string) => event ? (registered.get(event)?.size || 0) : registered.size;
      if (prop === 'eventNames') return () => Array.from(registered.keys());

      if (typeof currentValue === 'function') {
        return (...args: any[]) => execCmd(c => {
          const fn = (c as any)[prop];
          return typeof fn === 'function' ? fn.apply(c, args) : fn;
        });
      }

      if (targetValue !== undefined) return targetValue;
      return currentValue;
    },
    set(_target, prop, value) {
      (currentConn as any)[prop] = value;
      return true;
    },
    defineProperty(target, prop, descriptor) {
      try {
        Object.defineProperty(currentConn as any, prop, descriptor);
      } catch {}
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });

  return proxy;
}

// ─── Global state ──────────────────────────────────────────

let pool: RedisPool | null = null;
let pooledRedis: IORedis | null = null;
let poolUrls: string[] = [];

function ensurePool(): void {
  if (pool) return;
  poolUrls = parseRedisUrls();
  if (poolUrls.length === 0) return;
  pool = new RedisPool(poolUrls);
  pooledRedis = createPooledIORedis(pool);
}

// ─── Public API ────────────────────────────────────────────

/** Get a pooled IORedis instance (auto-rotates on limit exceeded).
 *  Returns null if no URLs configured -- callers fall back to in-memory. */
export function getRedisOptions(): IORedis | null {
  ensurePool();
  if (!pool || !pooledRedis) {
    logger.info('REDIS_URLS & REDIS_URL not configured - in-memory fallback enabled');
    return null;
  }
  if (!pool.hasAvailable()) {
    logger.error('All Redis tokens exhausted - in-memory fallback');
    return null;
  }
  return pooledRedis;
}

/** Get pooled connection as RedisRuntimeConnection (for rate limiter, etc.) */
export async function getRedisConnection(): Promise<RedisRuntimeConnection | null> {
  const client = getRedisOptions();
  return client || getMemoryConnection();
}

export async function getRedisClient(): Promise<RedisRuntimeConnection | null> {
  return getRedisConnection();
}

/** Get the raw pool (for admin status, diagnostics) */
export function getRedisPool(): RedisPool | null {
  ensurePool();
  return pool;
}

/** Shut down all Redis connections gracefully */
export async function shutdownRedis(): Promise<void> {
  if (pool) await pool.shutdown();
}
