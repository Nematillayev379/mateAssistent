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
exports.registerSystemRoutes = registerSystemRoutes;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../../config/config");
const database_1 = require("../../services/database");
const bot_instance_1 = require("../../services/bot_instance");
const logger_1 = require("../../utils/logger");
const finance_1 = require("../../services/finance");
const ai_1 = require("../../services/ai");
const auth_1 = require("../auth");
function registerSystemRoutes(app) {
    app.get('/health', (req, res) => res.json({ status: 'ok', bot: 'active', uptime: process.uptime() }));
    app.post('/api/bot/webhook', (0, express_rate_limit_1.default)({ windowMs: 1000, max: 100, keyGenerator: () => 'webhook' }), (req, res) => {
        const secret = req.headers['x-telegram-bot-api-secret-token'];
        if (secret !== config_1.CONFIG.WEBHOOK_SECRET)
            return res.sendStatus(403);
        if (!req.body || !req.body.update_id)
            return res.sendStatus(400);
        res.sendStatus(200);
        setImmediate(async () => {
            try {
                await bot_instance_1.bot.processUpdate(req.body);
            }
            catch (e) {
                logger_1.logger.warn(`Webhook process error: ${e.message}`);
            }
        });
    });
    app.get('/api/finance/prices', auth_1.checkAuth, async (req, res) => {
        try {
            const crypto = await finance_1.FinanceService.getCryptoPrices();
            const usd = await finance_1.FinanceService.getUSDRate();
            res.json({ btc: crypto.BTC || 'N/A', usd: usd || 'N/A' });
        }
        catch {
            res.json({ btc: 'N/A', usd: 'N/A' });
        }
    });
    app.get('/api/keys/:userId', auth_1.checkAuth, async (req, res) => res.json(await database_1.DBService.getUserApiKeys(parseInt(req.authenticatedUserId))));
    app.post('/api/keys', auth_1.checkAdmin, async (req, res) => {
        const userIdForKey = Number(req.body?.userId || req.authenticatedUserId);
        const { key, type } = req.body;
        if (!userIdForKey || !key || !type || typeof key !== 'string' || typeof type !== 'string')
            return res.status(400).json({ error: 'Invalid api key payload' });
        if (!config_1.CONFIG.API_KEY_SOURCES.includes(type))
            return res.status(400).json({ error: 'Unsupported API key type' });
        if (!(await (0, ai_1.validateKey)(type, key)))
            return res.status(400).json({ error: 'API key validation failed' });
        const { ApiKeyService } = await Promise.resolve().then(() => __importStar(require('../../services/apiKeys')));
        await ApiKeyService.addKey(userIdForKey, type, key);
        res.json({ success: true });
    });
    app.post('/api/keys/:userId', auth_1.checkAdmin, async (req, res) => {
        const { key, type } = req.body;
        if (!key || !type || typeof key !== 'string' || typeof type !== 'string')
            return res.status(400).json({ error: 'Invalid api key payload' });
        if (!config_1.CONFIG.API_KEY_SOURCES.includes(type))
            return res.status(400).json({ error: 'Unsupported API key type' });
        if (!(await (0, ai_1.validateKey)(type, key)))
            return res.status(400).json({ error: 'API key validation failed' });
        await database_1.DBService.addApiKey(parseInt(req.authenticatedUserId), key, type);
        res.json({ success: true });
    });
    app.delete('/api/keys/:id', auth_1.checkAdmin, async (req, res) => {
        const id = Number(req.params.id);
        if (!id || Number.isNaN(id))
            return res.status(400).json({ error: 'API key id required' });
        const { ApiKeyService } = await Promise.resolve().then(() => __importStar(require('../../services/apiKeys')));
        await ApiKeyService.removeKey(id);
        res.json({ success: true });
    });
    const dashboardPages = ['overview', 'sources', 'studio', 'automation', 'settings', 'distribution', 'analytics', 'wallet'];
    for (const page of dashboardPages) {
        app.get(`/dashboard/${page}`, (req, res) => {
            res.sendFile(path_1.default.join(process.cwd(), 'public', 'dashboard', `${page}.html`));
        });
    }
    app.get('/dashboard/admin', (req, res) => {
        res.sendFile(path_1.default.join(process.cwd(), 'public', 'dashboard', 'admin', 'index.html'));
    });
    const adminPages = ['overview', 'users', 'users-approvals', 'ai-keys', 'broadcast', 'broadcast-center', 'system', 'system-config', 'pricing', 'approval-queue'];
    for (const page of adminPages) {
        app.get(`/dashboard/admin/${page}`, (req, res) => {
            res.sendFile(path_1.default.join(process.cwd(), 'public', 'dashboard', 'admin', `${page}.html`));
        });
    }
    app.get('/dashboard', (req, res) => {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(302, `/dashboard/overview.html${qs}`);
    });
    app.get('/dashboard/', (req, res) => {
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        res.redirect(302, `/dashboard/overview.html${qs}`);
    });
    app.get('/', (req, res) => {
        res.sendFile(path_1.default.join(process.cwd(), 'public', 'landing.html'));
    });
    app.get('/login', (req, res) => {
        res.sendFile(path_1.default.join(process.cwd(), 'public', 'login.html'));
    });
    app.use((req, res, next) => {
        if (req.path.startsWith('/api/'))
            return res.status(404).json({ error: 'Not found' });
        res.sendFile(path_1.default.join(process.cwd(), 'public', 'landing.html'), (err) => { if (err && !res.headersSent)
            res.status(404).json({ error: 'Page not found' }); });
    });
}
