"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendAlert = sendAlert;
exports.isRedisConfigured = isRedisConfigured;
exports.checkRedisHealth = checkRedisHealth;
exports.checkSupabaseHealth = checkSupabaseHealth;
exports.checkAiKeysHealth = checkAiKeysHealth;
exports.runHealthCheck = runHealthCheck;
exports.setupHealthMonitoring = setupHealthMonitoring;
const bot_instance_1 = require("./bot_instance");
const logger_1 = require("../utils/logger");
const config_1 = require("../config/config");
const alertCooldowns = new Map();
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
let redisStartupLogged = false;
function canAlert(key) {
    const now = Date.now();
    const lastAlert = alertCooldowns.get(key) || 0;
    if (now - lastAlert < ALERT_COOLDOWN_MS)
        return false;
    alertCooldowns.set(key, now);
    return true;
}
async function sendAlert(type, message) {
    if (!config_1.CONFIG.OWNER_ID)
        return;
    if (!canAlert(type))
        return;
    try {
        await bot_instance_1.bot.sendMessage(config_1.CONFIG.OWNER_ID, `🚨 <b>${type}</b>\n\n${message}`, { parse_mode: 'HTML' });
    }
    catch (e) {
        logger_1.logger.warn(`Alert send failed: ${e.message}`);
    }
}
function isRedisConfigured() {
    return Boolean(config_1.CONFIG.REDIS_URL?.trim() ||
        config_1.CONFIG.REDIS_URLS?.trim() ||
        config_1.CONFIG.DEFAULT_REDIS_URL?.trim());
}
async function checkRedisHealth() {
    if (!isRedisConfigured()) {
        return false;
    }
    try {
        const { getRedisConnection } = await Promise.resolve().then(() => __importStar(require('./redis')));
        const conn = await getRedisConnection();
        if (!conn)
            return false;
        const pong = await conn.ping();
        return pong === 'PONG';
    }
    catch {
        return false;
    }
}
async function checkSupabaseHealth() {
    try {
        const { DBService } = await Promise.resolve().then(() => __importStar(require('./database')));
        const user = await DBService.getUser(0);
        return user !== undefined && user !== null;
    }
    catch {
        return false;
    }
}
async function checkAiKeysHealth() {
    try {
        const { getActiveKeyStats } = await Promise.resolve().then(() => __importStar(require('./ai')));
        const stats = getActiveKeyStats();
        return stats.total;
    }
    catch {
        return 0;
    }
}
async function runHealthCheck() {
    const [redis, supabase, aiKeys] = await Promise.all([
        checkRedisHealth(),
        checkSupabaseHealth(),
        checkAiKeysHealth(),
    ]);
    const memUsage = process.memoryUsage();
    const memoryUsage = Math.round(memUsage.heapUsed / 1024 / 1024);
    const status = {
        redis,
        supabase,
        aiKeys,
        lastRssRun: Date.now(),
        memoryUsage,
    };
    if (!redis && isRedisConfigured()) {
        await sendAlert('Redis Down', 'Redis ulanishi buzildi. Queue ishlamayapti.');
    }
    else if (!redis && !isRedisConfigured() && !redisStartupLogged) {
        logger_1.logger.info('Redis sozlanmagan - in-memory queue ishlayapti. Alert yuborilmaydi.');
        redisStartupLogged = true;
    }
    else if (redis && isRedisConfigured() && !redisStartupLogged) {
        logger_1.logger.info('Redis ulanishi muvaffaqiyatli - queue ishlayapti.');
        redisStartupLogged = true;
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
function setupHealthMonitoring() {
    setInterval(async () => {
        try {
            await runHealthCheck();
        }
        catch (e) {
            logger_1.logger.error(`Health check failed: ${e.message}`);
        }
    }, 5 * 60 * 1000);
    logger_1.logger.info('Health monitoring started (every 5 min)');
}
