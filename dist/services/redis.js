"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedisOptions = getRedisOptions;
exports.getRedisConnection = getRedisConnection;
exports.getRedisClient = getRedisClient;
exports.getRedisPool = getRedisPool;
exports.shutdownRedis = shutdownRedis;
const ioredis_1 = __importDefault(require("ioredis"));
const events_1 = require("events");
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
// ─── In-memory fallback ─────────────────────────────────────
let memoryConnection = null;
function getMemoryConnection() {
    if (memoryConnection)
        return memoryConnection;
    const store = new Map();
    const ttlTimers = new Map();
    memoryConnection = {
        status: 'ready',
        async ping() { return 'PONG'; },
        async get(key) {
            const entry = store.get(key);
            if (!entry)
                return null;
            if (Date.now() > entry.expiresAt) {
                store.delete(key);
                return null;
            }
            return entry.value ?? null;
        },
        async set(key, value) {
            store.set(key, { value, expiresAt: Infinity });
            return 'OK';
        },
        async del(...keys) {
            let removed = 0;
            for (const key of keys) {
                if (store.delete(key))
                    removed += 1;
                const t = ttlTimers.get(key);
                if (t) {
                    clearTimeout(t);
                    ttlTimers.delete(key);
                }
            }
            return removed;
        },
        async incr(key) {
            const entry = store.get(key);
            if (!entry || Date.now() > entry.expiresAt) {
                store.set(key, { value: '1', expiresAt: Infinity });
                return 1;
            }
            const next = parseInt(entry.value, 10) + 1;
            entry.value = String(next);
            return next;
        },
        async pexpire(key, ms) {
            const entry = store.get(key);
            if (!entry)
                return 0;
            entry.expiresAt = Date.now() + ms;
            const existing = ttlTimers.get(key);
            if (existing)
                clearTimeout(existing);
            ttlTimers.set(key, setTimeout(() => { store.delete(key); ttlTimers.delete(key); }, ms));
            return 1;
        },
    };
    return memoryConnection;
}
// ─── Parse multiple Redis URLs ─────────────────────────────
function parseRedisUrls() {
    const urls = [];
    const allowLocalRedis = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
    function pushUrl(rawUrl, source) {
        const t = rawUrl.trim();
        if (!t)
            return;
        const isLocal = /localhost|127\.0\.0\.1/i.test(t);
        if (isLocal && !allowLocalRedis) {
            logger_1.logger.warn(`Skipping local Redis URL from ${source} in production: ${t.replace(/:[^:@/]+@/, ':***@')}`);
            return;
        }
        urls.push(t);
    }
    if (config_1.CONFIG.REDIS_URLS && config_1.CONFIG.REDIS_URLS.trim()) {
        for (const u of config_1.CONFIG.REDIS_URLS.split(',')) {
            pushUrl(u, 'REDIS_URLS');
        }
    }
    if (config_1.CONFIG.REDIS_URL && config_1.CONFIG.REDIS_URL.trim()) {
        const existing = new Set(urls);
        const normalized = config_1.CONFIG.REDIS_URL.trim();
        if (!existing.has(normalized)) {
            const isLocal = /localhost|127\.0\.0\.1/i.test(normalized);
            if (isLocal && !allowLocalRedis) {
                logger_1.logger.warn(`Skipping local REDIS_URL in production: ${normalized.replace(/:[^:@/]+@/, ':***@')}`);
            }
            else {
                urls.unshift(normalized);
            }
        }
    }
    if (!urls.length && config_1.CONFIG.DEFAULT_REDIS_URL && config_1.CONFIG.DEFAULT_REDIS_URL.trim()) {
        const defaultUrl = config_1.CONFIG.DEFAULT_REDIS_URL.trim();
        const isLocalDefault = /localhost|127\.0\.0\.1/i.test(defaultUrl);
        if (!isLocalDefault || process.env.NODE_ENV === 'development') {
            urls.push(defaultUrl);
        }
    }
    return urls;
}
// Global registry of defined Lua commands to replay on rotated connections
const definedCommands = new Map();
class RedisPool {
    entries = [];
    currentIndex = 0;
    static RETRY_COOLDOWN_MS = 5 * 60 * 1000;
    static MAX_CONCURRENT = 3;
    constructor(urls) {
        this.entries = urls.map(url => ({
            url,
            exhausted: false,
            conn: null,
            lastAttempt: 0,
        }));
    }
    get active() {
        const entry = this.entries[this.currentIndex];
        if (!entry.conn) {
            entry.conn = this.createConnection(entry.url);
        }
        return entry.conn;
    }
    get status() {
        return this.active.status;
    }
    hasAvailable() {
        return this.entries.some(e => !e.exhausted);
    }
    get activeUrl() {
        return this.entries[this.currentIndex]?.url || '(none)';
    }
    get exhaustedCount() {
        return this.entries.filter(e => e.exhausted).length;
    }
    get totalCount() {
        return this.entries.length;
    }
    /** Mark current token as exhausted and rotate. Returns false if all exhausted. */
    markExhausted() {
        const oldEntry = this.entries[this.currentIndex];
        oldEntry.exhausted = true;
        oldEntry.lastAttempt = Date.now();
        logger_1.logger.warn(`Redis token exhausted: ${this.maskUrl(oldEntry.url)}`);
        if (oldEntry.conn) {
            try {
                oldEntry.conn.disconnect();
            }
            catch { /* ignore */ }
            oldEntry.conn = null;
        }
        const now = Date.now();
        for (let i = 0; i < this.entries.length; i++) {
            const idx = (this.currentIndex + 1 + i) % this.entries.length;
            const entry = this.entries[idx];
            if (!entry.exhausted || (now - entry.lastAttempt > RedisPool.RETRY_COOLDOWN_MS)) {
                this.currentIndex = idx;
                logger_1.logger.info(`Rotated to Redis token #${idx + 1}/${this.entries.length}: ${this.maskUrl(entry.url)}`);
                return true;
            }
        }
        logger_1.logger.error('All Redis tokens exhausted! Falling back to in-memory.');
        return false;
    }
    createConnection(url) {
        const conn = new ioredis_1.default(url, {
            lazyConnect: true,
            connectTimeout: 10000,
            maxRetriesPerRequest: null,
            retryStrategy: (times) => {
                if (times > 3) {
                    logger_1.logger.error(`Redis connection failed after 3 retries: ${this.maskUrl(url)}`);
                    return null;
                }
                return Math.min(times * 1000, 3000);
            },
        });
        // Replay defined commands
        for (const [name, definition] of definedCommands.entries()) {
            try {
                conn.defineCommand(name, definition);
            }
            catch (err) {
                logger_1.logger.error(`Failed to replay defined command "${name}" on rotated connection: ${err.message}`);
            }
        }
        return conn;
    }
    maskUrl(url) {
        try {
            const u = new URL(url);
            if (u.password)
                u.password = '***';
            return u.toString();
        }
        catch {
            return url.length > 20 ? url.slice(0, 10) + '...' + url.slice(-10) : url;
        }
    }
    /** Close all connections */
    async shutdown() {
        for (const entry of this.entries) {
            if (entry.conn) {
                try {
                    await entry.conn.quit();
                }
                catch { /* ignore */ }
                entry.conn = null;
            }
        }
    }
}
// ─── Pool-aware ioredis wrapper for BullMQ ─────────────────
// Uses Proxy to intercept all calls; the proxied target is an IORedis
// instance so BullMQ's `instanceof IORedis` check passes.
function createPooledIORedis(pool) {
    const registered = new Map();
    const ee = new events_1.EventEmitter();
    let currentConn = pool.active;
    attachPoolListeners(currentConn);
    function attachPoolListeners(conn) {
        conn.on('error', (err) => handleError(err, conn));
        conn.on('connect', () => ee.emit('connect'));
        conn.on('close', () => ee.emit('close'));
    }
    function handleError(err, _conn) {
        const isLimit = err.message?.includes('limit exceeded') || err.message?.toLowerCase().includes('exceeded');
        if (isLimit) {
            if (pool.markExhausted()) {
                currentConn = pool.active;
                attachPoolListeners(currentConn);
                for (const [event, handlers] of registered) {
                    for (const h of handlers)
                        currentConn.on(event, h);
                }
                logger_1.logger.info('Rotated to next Redis token');
            }
            return;
        }
        ee.emit('error', err);
    }
    async function execCmd(fn) {
        try {
            return await fn(currentConn);
        }
        catch (err) {
            if (err.message?.includes('limit exceeded') || err.message?.toLowerCase().includes('exceeded')) {
                if (pool.markExhausted()) {
                    currentConn = pool.active;
                    attachPoolListeners(currentConn);
                    for (const [event, handlers] of registered) {
                        for (const h of handlers)
                            currentConn.on(event, h);
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
    const dummy = new ioredis_1.default({ host: '127.0.0.1', port: 6379, lazyConnect: true, maxRetriesPerRequest: null });
    dummy.disconnect();
    function ensureCommandOnConnection(conn, propName) {
        if (typeof propName !== 'string')
            return;
        const baseName = propName.replace(/\d+$/, '');
        const definition = definedCommands.get(baseName) || definedCommands.get(propName);
        if (definition && typeof conn[propName] !== 'function') {
            try {
                conn.defineCommand(baseName, definition);
            }
            catch { }
        }
    }
    const proxy = new Proxy(dummy, {
        get(target, prop) {
            const currentValue = currentConn[prop];
            const targetValue = target[prop];
            // EventEmitter methods -> delegate to ee (local EventEmitter)
            if (typeof prop === 'string' && eventMethods.has(prop)) {
                return ee[prop].bind(ee);
            }
            if (prop === 'status')
                return currentConn.status;
            if (prop === 'connect')
                return async () => { if (currentConn.status !== 'ready')
                    await currentConn.connect(); };
            if (prop === 'disconnect')
                return async () => { try {
                    await currentConn.disconnect();
                }
                catch { } };
            if (prop === 'quit')
                return async () => { for (const e of pool.entries) {
                    if (e.conn) {
                        try {
                            await e.conn.quit();
                        }
                        catch { }
                        e.conn = null;
                    }
                } };
            if (prop === 'duplicate')
                return () => proxy;
            if (prop === 'defineCommand') {
                return (name, definition) => {
                    definedCommands.set(name, definition);
                    try {
                        dummy.defineCommand(name, definition);
                    }
                    catch { }
                    return currentConn.defineCommand(name, definition);
                };
            }
            // Event listener registration -> track and delegate to currentConn
            if (prop === 'on')
                return (event, handler) => {
                    if (!registered.has(event))
                        registered.set(event, new Set());
                    registered.get(event).add(handler);
                    currentConn.on(event, handler);
                    return proxy;
                };
            if (prop === 'off' || prop === 'removeListener')
                return (event, handler) => {
                    registered.get(event)?.delete(handler);
                    currentConn.off(event, handler);
                    return proxy;
                };
            if (prop === 'removeAllListeners')
                return (event) => {
                    if (event)
                        registered.delete(event);
                    else
                        registered.clear();
                    currentConn.removeAllListeners(event);
                    return proxy;
                };
            if (prop === 'emit')
                return (event, ...args) => ee.emit(event, ...args);
            if (prop === 'listenerCount')
                return (event) => event ? (registered.get(event)?.size || 0) : registered.size;
            if (prop === 'eventNames')
                return () => Array.from(registered.keys());
            if (typeof currentValue === 'function') {
                return (...args) => execCmd(c => {
                    ensureCommandOnConnection(c, prop);
                    const fn = c[prop];
                    return typeof fn === 'function' ? fn.apply(c, args) : fn;
                });
            }
            if (currentValue !== undefined)
                return currentValue;
            if (typeof prop === 'string') {
                ensureCommandOnConnection(currentConn, prop);
                const retryValue = currentConn[prop];
                if (typeof retryValue === 'function') {
                    return (...args) => execCmd(c => {
                        ensureCommandOnConnection(c, prop);
                        const fn = c[prop];
                        return typeof fn === 'function' ? fn.apply(c, args) : fn;
                    });
                }
            }
            return targetValue;
        },
        set(_target, prop, value) {
            currentConn[prop] = value;
            return true;
        },
        defineProperty(target, prop, descriptor) {
            try {
                Object.defineProperty(currentConn, prop, descriptor);
            }
            catch { }
            return Reflect.defineProperty(target, prop, descriptor);
        }
    });
    return proxy;
}
// ─── Global state ──────────────────────────────────────────
let pool = null;
let pooledRedis = null;
let poolUrls = [];
function ensurePool() {
    if (pool)
        return;
    poolUrls = parseRedisUrls();
    if (poolUrls.length === 0)
        return;
    pool = new RedisPool(poolUrls);
    pooledRedis = createPooledIORedis(pool);
}
// ─── Public API ────────────────────────────────────────────
/** Get a pooled IORedis instance (auto-rotates on limit exceeded).
 *  Returns null if no URLs configured -- callers fall back to in-memory. */
function getRedisOptions() {
    ensurePool();
    if (!pool || !pooledRedis) {
        logger_1.logger.info('REDIS_URLS & REDIS_URL not configured - in-memory fallback enabled');
        return null;
    }
    if (!pool.hasAvailable()) {
        logger_1.logger.error('All Redis tokens exhausted - in-memory fallback');
        return null;
    }
    return pooledRedis;
}
/** Get pooled connection as RedisRuntimeConnection (for rate limiter, etc.) */
async function getRedisConnection() {
    const client = getRedisOptions();
    return client || getMemoryConnection();
}
async function getRedisClient() {
    return getRedisConnection();
}
/** Get the raw pool (for admin status, diagnostics) */
function getRedisPool() {
    ensurePool();
    return pool;
}
/** Shut down all Redis connections gracefully */
async function shutdownRedis() {
    if (pool)
        await pool.shutdown();
}
