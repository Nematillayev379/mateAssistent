"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadQueue = exports.aiQueue = void 0;
exports.createMemoryQueue = createMemoryQueue;
exports.isMemoryQueueAvailable = isMemoryQueueAvailable;
exports.onShutdown = onShutdown;
exports.gracefulShutdown = gracefulShutdown;
const logger_1 = require("../utils/logger");
const queues = new Map();
const apiCache = new Map();
function createAPI(name, state) {
    return {
        add: async (type, data, opts) => {
            const id = opts?.jobId || `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const existing = state.tasks.find(t => t.id === id);
            if (existing)
                return;
            state.tasks.push({ id, type, data, attempts: 0, maxAttempts: opts?.attempts || 1, addedAt: Date.now() });
            setImmediate(() => processQueue(name));
        },
        process: (handler) => {
            state.handler = handler;
        },
        getWaitingCount: () => state.tasks.length,
        pause: async () => { state.running = false; },
        resume: async () => { state.running = true; setImmediate(() => processQueue(name)); },
        close: async () => {
            state.running = false;
            state.handler = null;
            state.tasks = [];
            queues.delete(name);
            apiCache.delete(name);
        },
    };
}
function createMemoryQueue(name, concurrency = 5) {
    const existing = apiCache.get(name);
    if (existing)
        return existing;
    const state = { tasks: [], handler: null, running: false, concurrency, active: 0 };
    queues.set(name, state);
    const api = createAPI(name, state);
    apiCache.set(name, api);
    return api;
}
async function processQueue(name) {
    const state = queues.get(name);
    if (!state || !state.handler || state.running)
        return;
    state.running = true;
    while (state.tasks.length > 0 && state.active < state.concurrency) {
        const task = state.tasks.shift();
        if (!task)
            continue;
        state.active++;
        processTask(name, task).finally(() => {
            state.active--;
            if (state.tasks.length > 0)
                setImmediate(() => processQueue(name));
        });
    }
    state.running = false;
}
async function processTask(name, task) {
    const state = queues.get(name);
    if (!state || !state.handler)
        return;
    try {
        await state.handler(task);
    }
    catch (err) {
        if (task.attempts < task.maxAttempts - 1) {
            task.attempts++;
            state.tasks.push(task);
        }
        else {
            logger_1.logger.warn(`[MemoryQueue:${name}] Task ${task.id} failed after ${task.attempts + 1} attempts: ${err.message}`);
        }
    }
}
const aiQueue = createMemoryQueue("ai", 3);
exports.aiQueue = aiQueue;
const downloadQueue = createMemoryQueue("download", 2);
exports.downloadQueue = downloadQueue;
function isMemoryQueueAvailable() { return true; }
const shutdownCallbacks = [];
function onShutdown(cb) {
    shutdownCallbacks.push(cb);
}
async function gracefulShutdown(timeoutMs = 10000) {
    logger_1.logger.info('[MemoryQueue] Shutting down gracefully...');
    const start = Date.now();
    for (const q of queues.values()) {
        if (q.tasks.length > 0) {
            logger_1.logger.info(`[MemoryQueue] Waiting for ${q.tasks.length} tasks (active: ${q.active})...`);
        }
    }
    while (true) {
        const busy = Array.from(queues.values()).some(q => q.active > 0 || q.tasks.length > 0);
        if (!busy)
            break;
        if (Date.now() - start > timeoutMs) {
            logger_1.logger.warn('[MemoryQueue] Shutdown timeout reached, force quitting');
            break;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    for (const cb of shutdownCallbacks) {
        try {
            await cb();
        }
        catch (e) {
            logger_1.logger.warn(`Shutdown callback failed: ${e?.message || 'unknown error'}`);
        }
    }
    logger_1.logger.info('[MemoryQueue] Shutdown complete');
}
