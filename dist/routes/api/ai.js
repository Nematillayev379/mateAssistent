"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAiRoutes = registerAiRoutes;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const database_1 = require("../../services/database");
const bot_instance_1 = require("../../services/bot_instance");
const logger_1 = require("../../utils/logger");
const ai_1 = require("../../services/ai");
const auth_1 = require("../../middleware/auth");
const sender_1 = require("../../services/sender");
function registerAiRoutes(app) {
    const aiLimiter = (0, express_rate_limit_1.default)({
        windowMs: 60 * 1000,
        max: async (req) => {
            const userId = req.headers['x-user-id'] || req.query.userId || req.body?.userId;
            if (userId)
                return (await database_1.DBService.isPremiumActive(parseInt(userId))) ? 30 : 10;
            return 10;
        },
        message: { error: 'AI request limit exceeded.' }
    });
    app.post('/api/ai/smm', auth_1.checkAuth, aiLimiter, async (req, res) => {
        const { prompt, withImage, language } = req.body;
        if (!prompt || typeof prompt !== 'string' || prompt.trim() === '')
            return res.status(400).json({ error: 'Prompt bo\'sh bo\'lishi mumkin emas.' });
        try {
            const user = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
            const postLanguage = typeof language === 'string' && language.trim() ? language.trim().slice(0, 8) : user?.language || 'uz';
            const [text, img] = await Promise.all([(0, ai_1.generateSmmPost)(prompt.trim(), postLanguage), withImage === true || withImage === 'true' ? (0, ai_1.generateSmmImage)(prompt.trim()) : Promise.resolve(null)]);
            res.json({ text, imageUrl: img?.imageUrl || null, imageBase64: img?.imageBase64 || null });
        }
        catch (e) {
            logger_1.logger.error(`SMM generate error: ${e.message}`);
            res.status(500).json({ error: 'AI xatolik' });
        }
    });
    app.post('/api/ai/post-to-channel', auth_1.checkAuth, async (req, res) => {
        const { text, imageUrl, imageBase64, prompt } = req.body;
        if (!text || typeof text !== 'string')
            return res.status(400).json({ error: 'Invalid text' });
        try {
            const user = await database_1.DBService.getUser(parseInt(req.authenticatedUserId));
            if (!user?.target_channel)
                return res.status(400).json({ error: 'No channel configured' });
            const title = typeof prompt === 'string' && prompt.trim() ? prompt.trim().slice(0, 120) : 'AI Studio Post';
            if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.startsWith('data:image')) {
                const caption = await (0, sender_1.buildChannelPostMarkup)({ title, content: text, source: 'AI Studio', url: process.env.PUBLIC_URL || '' }, { maxLength: 1024 });
                await bot_instance_1.bot.sendPhoto(user.target_channel, Buffer.from(imageBase64.split(',')[1], 'base64'), { caption, parse_mode: 'HTML' });
            }
            else if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
                const caption = await (0, sender_1.buildChannelPostMarkup)({ title, content: text, source: 'AI Studio', url: process.env.PUBLIC_URL || '' }, { maxLength: 1024 });
                await bot_instance_1.bot.sendPhoto(user.target_channel, imageUrl, { caption, parse_mode: 'HTML' });
            }
            else {
                const message = await (0, sender_1.buildChannelPostMarkup)({ title, content: text, source: 'AI Studio', url: process.env.PUBLIC_URL || '' });
                await bot_instance_1.bot.sendMessage(user.target_channel, message, { parse_mode: 'HTML' });
            }
            res.json({ success: true });
        }
        catch (e) {
            logger_1.logger.error(`SMM post-to-channel error: ${e.message}`);
            res.status(500).json({ error: 'Telegram send failed' });
        }
    });
}
