"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChannelsRoutes = registerChannelsRoutes;
const database_1 = require("../../services/database");
const telegram_monitor_1 = require("../../services/telegram_monitor");
const trends_1 = require("../../services/trends");
const auth_1 = require("../../middleware/auth");
function registerChannelsRoutes(app) {
    app.get('/api/channels/:userId', auth_1.checkAuth, async (req, res) => res.json(await database_1.DBService.getUserMonitoredChannels(parseInt(req.authenticatedUserId))));
    app.post('/api/channels/:userId', auth_1.checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const { platform, channelId, name, forward_mode, use_ai } = req.body;
        if (!['youtube', 'instagram', 'telegram'].includes(platform) || !channelId)
            return res.status(400).json({ error: 'Invalid channel payload' });
        let resolvedId = channelId, resolvedName = name || channelId;
        if (platform === 'telegram') {
            const verify = await telegram_monitor_1.TelegramMonitorService.verifyBotInSourceChannel(channelId);
            if (!verify.ok)
                return res.status(400).json({ error: verify.error || 'Bot manba kanalda admin emas' });
            resolvedId = verify.chatId || (0, telegram_monitor_1.normalizeTelegramChannelId)(channelId);
            resolvedName = verify.title || resolvedName;
        }
        if (!(await database_1.DBService.checkUserLimit(uid, 'channels')))
            return res.status(403).json({ error: 'Channel limit reached' });
        await database_1.DBService.addMonitoredChannel(uid, platform, resolvedId, resolvedName, { forward_mode: forward_mode || 'copy', use_ai: use_ai ? 1 : 0 });
        res.json({ success: true, channelId: resolvedId, name: resolvedName });
    });
    app.patch('/api/channels/:userId/:id', auth_1.checkAuth, async (req, res) => {
        const updates = {};
        if (req.body.forward_mode)
            updates.forward_mode = req.body.forward_mode;
        if (req.body.use_ai !== undefined)
            updates.use_ai = req.body.use_ai ? 1 : 0;
        if (req.body.is_active !== undefined)
            updates.is_active = req.body.is_active ? 1 : 0;
        await database_1.DBService.updateMonitoredChannelSettings(parseInt(req.params.id), parseInt(req.authenticatedUserId), updates);
        res.json({ success: true });
    });
    app.delete('/api/channels/:userId/:id', auth_1.checkAuth, async (req, res) => { await database_1.DBService.removeMonitoredChannel(parseInt(req.authenticatedUserId), parseInt(req.params.id)); res.json({ success: true }); });
    app.get('/api/trends/uz', auth_1.checkAuth, async (req, res) => {
        try {
            const data = await trends_1.TrendsService.scanUZTrends(req.query.refresh === '1' || req.query.refresh === 'true');
            res.json(data);
        }
        catch (e) {
            const cached = await database_1.DBService.getLatestTrendsSnapshot();
            if (cached)
                return res.json({ topics: cached.topics, summary: cached.summary, at: cached.created_at });
            res.status(500).json({ error: e.message });
        }
    });
}
