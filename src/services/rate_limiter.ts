import { logger } from "../utils/logger";
import { getRedisClient } from "./redis";

const RATE_LIMIT = 20;
const WINDOW_MS = 60_000;

const userBuckets = new Map<number, { count: number; resetAt: number }>();

let redisAvailable = false;
getRedisClient().then(c => redisAvailable = !!c).catch(() => {});

export async function checkRateLimit(userId: number): Promise<boolean> {
  if (redisAvailable) {
    try {
      const redis = await getRedisClient();
      if (redis) {
        const key = `ratelimit:${userId}`;
        const current = await redis.incr(key);
        if (current === 1) await redis.pexpire(key, WINDOW_MS);
        if (current > RATE_LIMIT) {
          logger.warn(`Rate limit exceeded for user ${userId} (${current}/${RATE_LIMIT})`);
          return false;
        }
        return true;
      }
    } catch { redisAvailable = false; }
  }

  const now = Date.now();
  const bucket = userBuckets.get(userId);

  if (!bucket || now > bucket.resetAt) {
    userBuckets.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (bucket.count >= RATE_LIMIT) {
    logger.warn(`Rate limit exceeded for user ${userId} (${bucket.count}/${RATE_LIMIT})`);
    return false;
  }

  bucket.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [id, bucket] of userBuckets) {
    if (now > bucket.resetAt) userBuckets.delete(id);
  }
}, 60_000);
