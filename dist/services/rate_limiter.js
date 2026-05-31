"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkRateLimit = checkRateLimit;
exports.checkCommandRateLimit = checkCommandRateLimit;
const logger_1 = require("../utils/logger");
const PER_SECOND_LIMIT = 10;
const PER_MINUTE_LIMIT = 30;
const WINDOW_SECOND_MS = 1_000;
const WINDOW_MINUTE_MS = 60_000;
const userBuckets = new Map();
async function checkRateLimit(userId) {
    const now = Date.now();
    let bucket = userBuckets.get(userId);
    if (!bucket || now > bucket.minuteResetAt) {
        userBuckets.set(userId, {
            secondCount: 1,
            secondResetAt: now + WINDOW_SECOND_MS,
            minuteCount: 1,
            minuteResetAt: now + WINDOW_MINUTE_MS,
        });
        return true;
    }
    if (now > bucket.secondResetAt) {
        bucket.secondCount = 0;
        bucket.secondResetAt = now + WINDOW_SECOND_MS;
    }
    bucket.secondCount++;
    bucket.minuteCount++;
    if (bucket.secondCount > PER_SECOND_LIMIT) {
        logger_1.logger.warn(`Per-second rate limit exceeded for user ${userId} (${bucket.secondCount}/${PER_SECOND_LIMIT})`);
        return false;
    }
    if (bucket.minuteCount > PER_MINUTE_LIMIT) {
        logger_1.logger.warn(`Per-minute rate limit exceeded for user ${userId} (${bucket.minuteCount}/${PER_MINUTE_LIMIT})`);
        return false;
    }
    return true;
}
async function checkCommandRateLimit(userId) {
    const now = Date.now();
    let bucket = userBuckets.get(userId);
    if (!bucket || now > bucket.minuteResetAt) {
        userBuckets.set(userId, {
            secondCount: 1,
            secondResetAt: now + WINDOW_SECOND_MS,
            minuteCount: 1,
            minuteResetAt: now + WINDOW_MINUTE_MS,
        });
        return true;
    }
    if (now > bucket.secondResetAt) {
        bucket.secondCount = 0;
        bucket.secondResetAt = now + WINDOW_SECOND_MS;
    }
    bucket.secondCount++;
    bucket.minuteCount++;
    if (bucket.secondCount > 5) {
        logger_1.logger.warn(`Command rate limit exceeded for user ${userId} (${bucket.secondCount}/5 per second)`);
        return false;
    }
    if (bucket.minuteCount > 15) {
        logger_1.logger.warn(`Command rate limit exceeded for user ${userId} (${bucket.minuteCount}/15 per minute)`);
        return false;
    }
    return true;
}
setInterval(() => {
    const now = Date.now();
    for (const [id, bucket] of userBuckets) {
        if (now > bucket.minuteResetAt)
            userBuckets.delete(id);
    }
}, 60_000);
