import { bot } from './bot_instance';
import { logger } from '../utils/logger';
import { CONFIG } from '../config/config';

interface HealthStatus {
  redis: boolean;
  supabase: boolean;
  aiKeys: number;
  lastRssRun: number;
  memoryUsage: number;
}

const alertCooldowns = new Map<string, number>();
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
const SUPABASE_FAILURE_THRESHOLD = 3;
let redisStartupLogged = false;

let supabaseConsecutiveFailures = 0;
let supabaseLastAlertedFailureCount = 0;
let supabaseIsDown = false;

function healthAlertsEnabled(): boolean {
  return process.env.HEALTH_ALERTS_ENABLED !== 'false';
}

function canAlert(key: string): boolean {
  if (!healthAlertsEnabled()) return false;
  const now = Date.now();
  const lastAlert = alertCooldowns.get(key) || 0;
  if (now - lastAlert < ALERT_COOLDOWN_MS) return false;
  alertCooldowns.set(key, now);
  return true;
}

export async function sendAlert(type: string, message: string): Promise<void> {
  if (!CONFIG.OWNER_ID) return;
  if (!canAlert(type)) return;

  try {
    await bot.sendMessage(CONFIG.OWNER_ID, `🚨 <b>${type}</b>\n\n${message}`, { parse_mode: 'HTML' });
  } catch (e: any) {
    logger.warn(`Alert send failed: ${e.message}`);
  }
}

export function isRedisConfigured(): boolean {
  return Boolean(
    CONFIG.REDIS_URL?.trim() ||
    CONFIG.REDIS_URLS?.trim() ||
    CONFIG.DEFAULT_REDIS_URL?.trim()
  );
}

export async function checkRedisHealth(): Promise<boolean> {
  if (!isRedisConfigured()) {
    return false;
  }
  const result = await withTimeout((async () => {
    const { getRedisConnection } = await import('./redis');
    const conn = await getRedisConnection();
    if (!conn) return false;
    const pong = await conn.ping();
    return pong === 'PONG';
  })(), 3000, 'Redis ping');
  if (result === null) return true;
  return result === true;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T | null>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } catch (err: any) {
    logger.warn(`Health check ${label}: ${err.message}`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkSupabaseHealth(): Promise<boolean> {
  const result = await withTimeout((async () => {
    const { getSupabase } = await import('../repositories/BaseRepository');
    const supabase = getSupabase();
    const { error } = await supabase.from('users').select('telegram_id').limit(1).maybeSingle();
    if (error) {
      logger.warn(`Supabase health check error: ${error.message}`);
      return false;
    }
    return true;
  })(), 5000, 'Supabase ping');
  if (result === null) {
    logger.warn('Supabase health check timed out');
    return false;
  }
  return result === true;
}

export async function checkAiKeysHealth(): Promise<number> {
  try {
    const { getActiveKeyStats } = await import('./ai');
    const stats = getActiveKeyStats();
    return stats.total;
  } catch {
    return 0;
  }
}

export async function runHealthCheck(): Promise<HealthStatus> {
  const [redis, supabase, aiKeys] = await Promise.all([
    checkRedisHealth(),
    checkSupabaseHealth(),
    checkAiKeysHealth(),
  ]);

  const memUsage = process.memoryUsage();
  const memoryUsage = Math.round(memUsage.heapUsed / 1024 / 1024);

  const status: HealthStatus = {
    redis,
    supabase,
    aiKeys,
    lastRssRun: Date.now(),
    memoryUsage,
  };

  if (!redis && isRedisConfigured()) {
    await sendAlert('Redis Down', 'Redis ulanishi buzildi. Queue ishlamayapti.');
  } else if (!redis && !isRedisConfigured() && !redisStartupLogged) {
    logger.info('Redis sozlanmagan - in-memory queue ishlayapti. Alert yuborilmaydi.');
    redisStartupLogged = true;
  } else if (redis && isRedisConfigured() && !redisStartupLogged) {
    logger.info('Redis ulanishi muvaffaqiyatli - queue ishlayapti.');
    redisStartupLogged = true;
  }

  if (redis && isRedisConfigured()) {
    try {
      const { getRedisPool } = await import('./redis');
      const pool = getRedisPool();
      if (pool) {
        const total = pool.totalCount;
        const exhausted = pool.exhaustedCount;
        const activeUrl = pool.activeUrl.replace(/:[^:@/]+@/, ':***@');
        if (exhausted > 0) {
          logger.warn(`Redis pool: ${total - exhausted}/${total} active, ${exhausted} exhausted. Active: ${activeUrl}`);
        } else {
          logger.info(`Redis pool: ${total}/${total} active. Active: ${activeUrl}`);
        }
      }
    } catch {}
  }

  if (!supabase) {
    supabaseConsecutiveFailures++;
    if (supabaseConsecutiveFailures >= SUPABASE_FAILURE_THRESHOLD && supabaseConsecutiveFailures > supabaseLastAlertedFailureCount) {
      supabaseLastAlertedFailureCount = supabaseConsecutiveFailures;
      supabaseIsDown = true;
      await sendAlert(
        'Database Down',
        `Supabase ulanishi ${supabaseConsecutiveFailures} marta ketma-ket ishlamadi. Barcha operatsiyalar to'xtatilgan bo'lishi mumkin.`
      );
    }
  } else {
    if (supabaseIsDown) {
      supabaseIsDown = false;
      supabaseConsecutiveFailures = 0;
      supabaseLastAlertedFailureCount = 0;
      if (CONFIG.OWNER_ID) {
        try {
          await bot.sendMessage(CONFIG.OWNER_ID, `✅ <b>Database Up</b>\n\nSupabase ulanishi tiklandi. Barcha operatsiyalar qayta faollashtirildi.`, { parse_mode: 'HTML' });
        } catch (e: any) {
          logger.warn(`Recovery alert send failed: ${e.message}`);
        }
      }
    } else {
      supabaseConsecutiveFailures = 0;
      supabaseLastAlertedFailureCount = 0;
    }
  }

  if (aiKeys === 0) {
    await sendAlert('AI Keys Empty', 'Barcha AI kalitlar tugadi yoki noto\'g\'ri.');
  }

  if (memoryUsage > 1024) {
    await sendAlert('High Memory', `Xotira ishlatilishi: ${memoryUsage}MB. OOM xavfi bor.`);
  }

  return status;
}

export function setupHealthMonitoring(): void {
  setInterval(async () => {
    try {
      await runHealthCheck();
    } catch (e: any) {
      logger.error(`Health check failed: ${e.message}`);
    }
  }, 5 * 60 * 1000);

  setTimeout(() => {
    runHealthCheck().catch((e: any) => logger.error(`Initial health check failed: ${e.message}`));
  }, 3000);

  logger.info('Health monitoring started (every 5 min, first run in 3s)');
}
