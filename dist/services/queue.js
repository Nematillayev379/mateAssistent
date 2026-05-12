"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiQueue = exports.scraperQueue = void 0;
exports.isRedisAvailable = isRedisAvailable;
exports.addScraperJob = addScraperJob;
exports.addAIJob = addAIJob;
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
let _redisAvailable = false;
let scraperQueue = null;
exports.scraperQueue = scraperQueue;
let aiQueue = null;
exports.aiQueue = aiQueue;
function tryInitRedis() {
    const redisUrl = config_1.CONFIG.REDIS_URL;
    if (!redisUrl || redisUrl.trim() === '') {
        logger_1.logger.warn('⚠️ REDIS_URL not set — queue disabled, using direct processing');
        return;
    }
    try {
        const { Queue } = require('bullmq');
        const IORedis = require('ioredis');
        const conn = new IORedis(redisUrl, {
            maxRetriesPerRequest: null,
            lazyConnect: true,
            connectTimeout: 5000,
        });
        conn.on('error', (err) => {
            if (_redisAvailable) {
                logger_1.logger.warn(`⚠️ Redis connection error: ${err.message} — switching to direct processing`);
            }
            _redisAvailable = false;
        });
        conn.on('ready', () => {
            logger_1.logger.info('✅ Redis connected — queue mode active');
            _redisAvailable = true;
        });
        exports.scraperQueue = scraperQueue = new Queue('scraper-queue', { connection: conn });
        exports.aiQueue = aiQueue = new Queue('ai-queue', { connection: conn });
        conn.connect().then(() => { _redisAvailable = true; }).catch(() => {
            _redisAvailable = false;
        });
    }
    catch (err) {
        logger_1.logger.warn(`⚠️ Failed to init Redis: ${err.message} — using direct processing`);
        _redisAvailable = false;
    }
}
tryInitRedis();
function isRedisAvailable() {
    return _redisAvailable;
}
async function addScraperJob(data) {
    if (!_redisAvailable || !scraperQueue) {
        logger_1.logger.debug('Queue not available — caller should use direct processing');
        return;
    }
    try {
        await scraperQueue.add('scrape-rss', data, {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
        });
    }
    catch (err) {
        logger_1.logger.warn(`addScraperJob failed: ${err.message}`);
    }
}
async function addAIJob(data) {
    if (!_redisAvailable || !aiQueue) {
        logger_1.logger.debug('Queue not available — caller should use direct processing');
        return;
    }
    try {
        await aiQueue.add('process-ai', data, {
            attempts: 2,
            backoff: { type: 'fixed', delay: 2000 },
        });
    }
    catch (err) {
        logger_1.logger.warn(`addAIJob failed: ${err.message}`);
    }
}
