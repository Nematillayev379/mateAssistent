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
exports.scraperQueue = redisOptions ? new bullmq_1.Queue('scraper-queue', {
    connection: redisOptions,
    defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: 100
    }
}) : null;
exports.aiQueue = redisOptions ? new bullmq_1.Queue('ai-queue', {
    connection: redisOptions,
    defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: 100
    }
}) : null;
function isRedisAvailable() {
    return !!redisOptions;
}
// BUG-111 Fix: Added logging for silent fails
async function addScraperJob(data) {
    if (!exports.scraperQueue) {
        logger_1.logger.debug('addScraperJob: Redis not available, skipping queue');
        return;
    }
    try {
        await exports.scraperQueue.add('scrape-rss', data);
    }
    catch (err) {
        logger_1.logger.error(`addScraperJob failed: ${err.message}`);
    }
}
async function addAIJob(data) {
    if (!exports.aiQueue) {
        logger_1.logger.debug('addAIJob: Redis not available, skipping queue');
        return;
    }
    try {
        await exports.aiQueue.add('process-ai', data);
    }
    catch (err) {
        logger_1.logger.error(`addAIJob failed: ${err.message}`);
    }
}
