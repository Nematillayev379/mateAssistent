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
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
let redisStartupLogged = false;

function canAlert(key: string): boolean {
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
  try {
    const { getRedisConnection } = await import('./redis');
    const conn = await getRedisConnection();
    if (!conn) return false;
    const pong = await conn.ping();
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function checkSupabaseHealth(): Promise<boolean> {
  try {
    const { DBService } = await import('./database');
    const user = await DBService.getUser(0);
    return user !== undefined && user !== null;
  } catch {
    return false;
  }
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
    await sendAlert('Database Down', 'Supabase ulanishi buzildi. Barcha operatsiyalar to\'xtadi.');
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

  logger.info('Health monitoring started (every 5 min)');
}
