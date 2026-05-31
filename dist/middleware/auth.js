"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyTelegramWebAppData = exports.checkAdmin = exports.checkAuth = exports.timingSafeCompare = exports.extractUserId = void 0;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config/config");
const database_1 = require("../services/database");
const bot_instance_1 = require("../services/bot_instance");
const logger_1 = require("../utils/logger");
const extractUserId = (req) => {
    return String(req.headers['x-user-id'] ||
        req.params.userId ||
        req.query.userId ||
        req.query.user ||
        req.body?.userId ||
        '');
};
exports.extractUserId = extractUserId;
const timingSafeCompare = (str1, str2) => {
    if (!str1 || !str2)
        return false;
    const b1 = Buffer.from(str1, 'utf8');
    const b2 = Buffer.from(str2, 'utf8');
    if (b1.length !== b2.length)
        return false;
    return crypto_1.default.timingSafeEqual(b1, b2);
};
exports.timingSafeCompare = timingSafeCompare;
const checkAuth = (req, res, next) => {
    const token = req.headers['x-bot-token'] || req.query.token || (req.headers.authorization?.split(' ')[1] ?? '');
    if (!token)
        return res.status(401).json({ error: 'Unauthorized' });
    if (token && config_1.CONFIG.DASHBOARD_SECRET && (0, exports.timingSafeCompare)(token, config_1.CONFIG.DASHBOARD_SECRET)) {
        if (config_1.CONFIG.OWNER_ID == null)
            return res.status(500).json({ error: 'Owner ID not configured' });
        req.authenticatedUserId = String(config_1.CONFIG.OWNER_ID);
        return next();
    }
    const userId = (0, exports.extractUserId)(req);
    if (!userId)
        return res.status(401).json({ error: 'Unauthorized' });
    if (token !== (0, bot_instance_1.generateDashboardToken)(userId))
        return res.status(401).json({ error: 'Invalid token for this user' });
    req.authenticatedUserId = userId;
    if ((0, config_1.isOwnerId)(parseInt(userId))) {
        database_1.DBService.getUser(parseInt(userId)).then(async (user) => {
            if (user && user.role !== 'owner') {
                await database_1.DBService.updateUserRole(parseInt(userId), 'owner');
            }
        }).catch((e) => logger_1.logger.warn(`Owner role sync failed: ${e.message}`));
    }
    next();
};
exports.checkAuth = checkAuth;
const checkAdmin = async (req, res, next) => {
    const token = req.headers['x-bot-token'] || req.query.token || (req.headers.authorization?.split(' ')[1] ?? '');
    const adminId = (0, exports.extractUserId)(req);
    if (token && config_1.CONFIG.DASHBOARD_SECRET && (0, exports.timingSafeCompare)(token, config_1.CONFIG.DASHBOARD_SECRET)) {
        if (config_1.CONFIG.OWNER_ID == null)
            return res.status(500).json({ error: 'Owner ID not configured' });
        req.authenticatedUserId = String(config_1.CONFIG.OWNER_ID);
        return next();
    }
    if (!adminId || !token)
        return res.status(401).json({ error: 'Unauthorized' });
    if (token !== (0, bot_instance_1.generateDashboardToken)(adminId))
        return res.status(401).json({ error: 'Invalid admin token' });
    const adminUid = parseInt(adminId);
    const user = await database_1.DBService.getUser(adminUid);
    const isAdmin = user && (user.role === 'owner' || user.role === 'admin' || user.is_owner === 1 || (0, config_1.isOwnerId)(adminUid));
    if (!isAdmin)
        return res.status(403).json({ error: 'Forbidden: Admin access only' });
    req.authenticatedUserId = adminId;
    next();
};
exports.checkAdmin = checkAdmin;
const verifyTelegramWebAppData = (telegramInitData) => {
    try {
        const initData = new URLSearchParams(telegramInitData);
        const hash = initData.get('hash');
        if (!hash) {
            logger_1.logger.warn('Telegram auth failed: hash is missing');
            return null;
        }
        const authDate = initData.get('auth_date');
        if (!authDate) {
            logger_1.logger.warn('Telegram auth failed: auth_date is missing');
            return null;
        }
        const authTs = parseInt(authDate, 10);
        if (isNaN(authTs)) {
            logger_1.logger.warn(`Telegram auth failed: auth_date "${authDate}" is not a number`);
            return null;
        }
        const timeDiff = Math.abs(Date.now() / 1000 - authTs);
        if (timeDiff > 86400) {
            logger_1.logger.warn(`Telegram auth failed: auth_date age ${timeDiff}s exceeds 24 hours limit`);
            return null;
        }
        initData.delete('hash');
        const keys = Array.from(initData.keys()).sort();
        const dataCheckString = keys.map(key => `${key}=${initData.get(key)}`).join('\n');
        const secretKey = crypto_1.default.createHmac('sha256', 'WebAppData').update((config_1.CONFIG.TELEGRAM_TOKEN || '').trim()).digest();
        const calculatedHash = crypto_1.default.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        if (calculatedHash === hash) {
            const userStr = initData.get('user');
            return userStr ? JSON.parse(userStr) : null;
        }
        logger_1.logger.warn(`Telegram auth failed: hash mismatch`);
        return null;
    }
    catch (e) {
        logger_1.logger.error(`Telegram auth exception: ${e.message}`);
        return null;
    }
};
exports.verifyTelegramWebAppData = verifyTelegramWebAppData;
