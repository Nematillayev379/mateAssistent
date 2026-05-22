import { logger } from "../utils/logger";

const RATE_LIMIT = 20;
const WINDOW_MS = 60_000;

const userBuckets = new Map<number, { count: number; resetAt: number }>();

export async function checkRateLimit(userId: number): Promise<boolean> {
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
