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
let connectPromise = null;
let memoryConnection = null;
function getMemoryConnection() {
    if (memoryConnection)
        return memoryConnection;
    const store = new Map();
    memoryConnection = {
        status: 'ready',
        async ping() {
            return 'PONG';
        },
        async get(key) {
            return store.get(key) ?? null;
        },
        async set(key, value) {
            store.set(key, value);
            return 'OK';
        },
        async del(...keys) {
            let removed = 0;
            for (const key of keys) {
                if (store.delete(key))
                    removed += 1;
            }
            return removed;
        },
    };
    return memoryConnection;
}
function getRedisOptions() {
    if (!config_1.CONFIG.REDIS_URL || config_1.CONFIG.REDIS_URL.trim() === '') {
        logger_1.logger.info('REDIS_URL not configured - queue workers disabled, in-memory Redis fallback enabled');
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
async function getRedisConnection() {
    const redisOptions = getRedisOptions();
    if (!redisOptions)
        return getMemoryConnection();
    if (!redisConnection) {
        try {
            redisConnection = new ioredis_1.default(redisOptions);
            redisConnection.on('error', (err) => {
                logger_1.logger.error(`Redis connection error: ${err.message}`);
            });
            redisConnection.on('connect', () => {
                logger_1.logger.info('Shared Redis connection established');
            });
            redisConnection.on('close', () => {
                logger_1.logger.warn('Redis connection closed');
                redisConnection = null;
                connectPromise = null;
            });
        }
        catch (err) {
            logger_1.logger.error(`Failed to create Redis connection: ${err.message}`);
            redisConnection = null;
            return null;
        }
    }
    if (redisConnection.status !== 'ready') {
        connectPromise ||= redisConnection.connect()
            .then(() => redisConnection)
            .catch((err) => {
            logger_1.logger.error(`Redis connect failed: ${err.message}`);
            redisConnection = null;
            connectPromise = null;
            return null;
        });
        await connectPromise;
    }
    return redisConnection;
}
