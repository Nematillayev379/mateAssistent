"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiQueue = exports.scraperQueue = void 0;
exports.isRedisAvailable = isRedisAvailable;
exports.addScraperJob = addScraperJob;
exports.addAIJob = addAIJob;
const bullmq_1 = require("bullmq");
const logger_1 = require("../utils/logger");
const redis_1 = require("./redis");
const redisOptions = (0, redis_1.getRedisOptions)();
// When a queue job fails due to limit-exceeded, rotate the pool
function handleLimitError(err) {
    if (err?.message?.includes('limit exceeded') || err?.message?.toLowerCase().includes('exceeded')) {
        const pool = (0, redis_1.getRedisPool)();
        if (pool && pool.markExhausted()) {
            logger_1.logger.warn('Queue: limit exceeded, pool rotated');
        }
        else {
            logger_1.logger.error('Queue: limit exceeded, no tokens left');
        }
    }
}
exports.scraperQueue = redisOptions ? new bullmq_1.Queue('scraper-queue', {
    connection: redisOptions,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
    }
}) : null;
exports.aiQueue = redisOptions ? new bullmq_1.Queue('ai-queue', {
    connection: redisOptions,
    defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
    }
}) : null;
if (exports.scraperQueue)
    exports.scraperQueue.on('error', handleLimitError);
if (exports.aiQueue)
    exports.aiQueue.on('error', handleLimitError);
function isRedisAvailable() {
    const pool = (0, redis_1.getRedisPool)();
    return !!pool && pool.hasAvailable();
}
async function addScraperJob(data) {
    if (!exports.scraperQueue) {
        logger_1.logger.debug('addScraperJob: Redis not available, skipping queue');
        return false;
    }
    const pool = (0, redis_1.getRedisPool)();
    if (!pool || !pool.hasAvailable()) {
        logger_1.logger.debug('addScraperJob: all Redis tokens exhausted, skipping queue');
        return false;
    }
    try {
        await exports.scraperQueue.add('scrape-rss', data);
        return true;
    }
    catch (err) {
        logger_1.logger.error(`addScraperJob failed: ${err.message}`);
        return false;
    }
}
async function addAIJob(data) {
    if (!exports.aiQueue) {
        logger_1.logger.debug('addAIJob: Redis not available, skipping queue');
        return false;
    }
    const pool = (0, redis_1.getRedisPool)();
    if (!pool || !pool.hasAvailable()) {
        logger_1.logger.debug('addAIJob: all Redis tokens exhausted, skipping queue');
        return false;
    }
    try {
        await exports.aiQueue.add('process-ai', data);
        return true;
    }
    catch (err) {
        logger_1.logger.error(`addAIJob failed: ${err.message}`);
        return false;
    }
}
