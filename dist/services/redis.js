"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedisOptions = getRedisOptions;
exports.getRedisConnection = getRedisConnection;
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
let redisConnection = null;
function getRedisOptions() {
    if (!config_1.CONFIG.REDIS_URL || config_1.CONFIG.REDIS_URL.trim() === '') {
        logger_1.logger.info('ℹ️ REDIS_URL not configured - Redis features disabled');
        return null;
    }
    return {
        url: config_1.CONFIG.REDIS_URL,
        lazyConnect: true,
        connectTimeout: 10000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        autoResubscribe: false,
        autoResendUnfulfilledCommands: false,
        retryStrategy: (times) => {
            if (times > 3) {
                logger_1.logger.error('Redis connection failed after 3 retries');
                return null;
            }
            return Math.min(times * 1000, 3000);
        }
    };
}
// BUG-113 Fix: Allow retry on connection failure
function getRedisConnection() {
    if (!redisConnection) {
        const redisOptions = getRedisOptions();
        if (!redisOptions)
            return null;
        try {
            redisConnection = new ioredis_1.default(redisOptions);
            redisConnection.on('error', (err) => {
                logger_1.logger.error(`Redis connection error: ${err.message}`);
            });
            redisConnection.on('connect', () => {
                logger_1.logger.info('✅ Shared Redis connection established');
            });
            // BUG-113 Fix: Reset connection on close so next call can retry
            redisConnection.on('close', () => {
                logger_1.logger.warn('⚠️ Redis connection closed');
                redisConnection = null;
            });
            redisConnection.connect().catch((err) => {
                logger_1.logger.error(`Redis connect failed: ${err.message}`);
                redisConnection = null;
            });
        }
        catch (err) {
            logger_1.logger.error(`Failed to create Redis connection: ${err.message}`);
            redisConnection = null;
            return null;
        }
    }
    return redisConnection;
}
