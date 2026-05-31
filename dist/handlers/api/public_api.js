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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerPublicApiRoutes = registerPublicApiRoutes;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const database_1 = require("../../services/database");
async function checkApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (!apiKey)
        return res.status(401).json({ error: 'API key required. Use X-API-Key header.' });
    const keys = await database_1.DBService.getValidApiKeys();
    const match = keys.find((k) => k.key === apiKey);
    if (!match)
        return res.status(403).json({ error: 'Invalid API key' });
    req.apiUserId = match.user_id;
    next();
}
function registerPublicApiRoutes(app) {
    const publicLimiter = (0, express_rate_limit_1.default)({ windowMs: 60 * 1000, max: 30, message: { error: 'API rate limit exceeded.' } });
    app.use('/api/v1', publicLimiter);
    app.use('/api/v1', checkApiKey);
    app.get('/api/v1/me', async (req, res) => {
        const user = await database_1.DBService.getUser(req.apiUserId);
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        res.json({
            id: user.telegram_id,
            username: user.username,
            role: user.role,
            is_premium: user.is_premium,
            premium_until: user.premium_until,
            language: user.language,
        });
    });
    app.post('/api/v1/publish', async (req, res) => {
        const { channel, text, parse_mode } = req.body;
        if (!channel || !text)
            return res.status(400).json({ error: 'channel and text required' });
        try {
            const { bot } = await Promise.resolve().then(() => __importStar(require('../../services/bot_instance')));
            const sent = await bot.sendMessage(channel, text, { parse_mode: parse_mode || 'HTML' });
            await database_1.DBService.incrementStat(req.apiUserId, 'total_posts');
            res.json({ success: true, message_id: sent.message_id });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/v1/sources', async (req, res) => {
        const sources = await database_1.DBService.getUserSources(req.apiUserId);
        res.json(sources.map((s) => ({ id: s.id, name: s.name, url: s.url, lang: s.lang })));
    });
    app.get('/api/v1/stats', async (req, res) => {
        const stats = await database_1.DBService.getStats(req.apiUserId);
        res.json(stats || { total_posts: 0, total_duplicates: 0 });
    });
    app.get('/api/v1/referral', async (req, res) => {
        const stats = await database_1.DBService.getReferralStats(req.apiUserId);
        const code = await database_1.DBService.ensureReferralCode(req.apiUserId);
        const refLink = `https://t.me/${process.env.BOT_USERNAME || 'bot'}?start=ref_${code}`;
        res.json({ link: refLink, ...stats });
    });
}
