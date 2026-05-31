import { logger } from "../utils/logger";

interface QueueTask {
  id: string;
  type: string;
  data: any;
  attempts: number;
  maxAttempts: number;
  addedAt: number;
}

type TaskHandler = (task: QueueTask) => Promise<void>;

interface QueueState {
  tasks: QueueTask[];
  handler: TaskHandler | null;
  running: boolean;
  concurrency: number;
  active: number;
}

interface MemoryQueue {
  add: (type: string, data: any, opts?: { jobId?: string; attempts?: number }) => Promise<void>;
  process: (handler: TaskHandler) => void;
  getWaitingCount: () => number;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  close: () => Promise<void>;
}

const queues = new Map<string, QueueState>();
const apiCache = new Map<string, MemoryQueue>();

function createAPI(name: string, state: QueueState): MemoryQueue {
  return {
    add: async (type: string, data: any, opts?: { jobId?: string; attempts?: number }) => {
      const id = opts?.jobId || `${name}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const existing = state.tasks.find(t => t.id === id);
      if (existing) return;
      state.tasks.push({ id, type, data, attempts: 0, maxAttempts: opts?.attempts || 1, addedAt: Date.now() });
      setImmediate(() => processQueue(name));
    },
    process: (handler: TaskHandler) => {
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

export function createMemoryQueue(name: string, concurrency: number = 5): MemoryQueue {
  const existing = apiCache.get(name);
  if (existing) return existing;

  const state: QueueState = { tasks: [], handler: null, running: false, concurrency, active: 0 };
  queues.set(name, state);
  const api = createAPI(name, state);
  apiCache.set(name, api);
  return api;
}

async function processQueue(name: string) {
  const state = queues.get(name);
  if (!state || !state.handler || state.running) return;
  state.running = true;

  while (state.tasks.length > 0 && state.active < state.concurrency) {
    const task = state.tasks.shift();
    if (!task) continue;

    state.active++;
    processTask(name, task).finally(() => {
      state.active--;
      if (state.tasks.length > 0) setImmediate(() => processQueue(name));
    });
  }

  state.running = false;
}

async function processTask(name: string, task: QueueTask) {
  const state = queues.get(name);
  if (!state || !state.handler) return;

  try {
    await state.handler(task);
  } catch (err: any) {
    if (task.attempts < task.maxAttempts - 1) {
      task.attempts++;
      state.tasks.push(task);
    } else {
      logger.warn(`[MemoryQueue:${name}] Task ${task.id} failed after ${task.attempts + 1} attempts: ${err.message}`);
    }
  }
}

const aiQueue = createMemoryQueue("ai", 3);
const downloadQueue = createMemoryQueue("download", 2);

export { aiQueue, downloadQueue };
export function isMemoryQueueAvailable() { return true; }

const shutdownCallbacks: (() => Promise<void>)[] = [];
export function onShutdown(cb: () => Promise<void>) {
  shutdownCallbacks.push(cb);
}

export async function gracefulShutdown(timeoutMs = 10000): Promise<void> {
  logger.info('[MemoryQueue] Shutting down gracefully...');
  const start = Date.now();
  for (const q of queues.values()) {
    if (q.tasks.length > 0) {
      logger.info(`[MemoryQueue] Waiting for ${q.tasks.length} tasks (active: ${q.active})...`);
    }
  }
  while (true) {
    const busy = Array.from(queues.values()).some(q => q.active > 0 || q.tasks.length > 0);
    if (!busy) break;
    if (Date.now() - start > timeoutMs) {
      logger.warn('[MemoryQueue] Shutdown timeout reached, force quitting');
      break;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  for (const cb of shutdownCallbacks) {
    try { await cb(); } catch (e: any) { logger.warn(`Shutdown callback failed: ${e?.message || 'unknown error'}`); }
  }
  logger.info('[MemoryQueue] Shutdown complete');
}
