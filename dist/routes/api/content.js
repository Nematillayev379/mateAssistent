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
exports.registerContentRoutes = registerContentRoutes;
const database_1 = require("../../services/database");
const bot_instance_1 = require("../../services/bot_instance");
const sender_1 = require("../../services/sender");
const auth_1 = require("../../middleware/auth");
function registerContentRoutes(app) {
    app.post('/api/posts/publish', auth_1.checkAuth, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const { text, imageUrl, channels } = req.body;
        if (!text || typeof text !== 'string')
            return res.status(400).json({ error: 'Text required' });
        const user = await database_1.DBService.getUser(uid);
        if (!user)
            return res.status(404).json({ error: 'Not found' });
        const targets = Array.isArray(channels) && channels.length ? channels : database_1.DBService.getUserOutputChannels(user);
        if (!targets.length)
            return res.status(400).json({ error: 'No output channels configured' });
        await (0, sender_1.safeSendToChannels)(user, targets, async (target) => {
            if (imageUrl)
                await bot_instance_1.bot.sendPhoto(target, imageUrl, { caption: text, parse_mode: 'HTML' });
            else
                await bot_instance_1.bot.sendMessage(target, text, { parse_mode: 'HTML' });
        });
        await database_1.DBService.incrementStat(uid, 'total_posts');
        res.json({ success: true, sentTo: targets.length });
    });
    app.post('/api/posts/draft', auth_1.checkAuth, async (req, res) => {
        const { title, body, image_url, channels } = req.body;
        if (!body)
            return res.status(400).json({ error: 'Body required' });
        const draft = await database_1.DBService.savePostDraft(parseInt(req.authenticatedUserId), { title, body, image_url, channels });
        res.json({ success: true, draft });
    });
    app.get('/api/posts/drafts/:userId', auth_1.checkAuth, async (req, res) => res.json(await database_1.DBService.getUserPostDrafts(parseInt(req.authenticatedUserId))));
    app.get('/api/tickets/all', auth_1.checkAdmin, async (req, res) => res.json(await database_1.DBService.getTickets()));
    app.get('/api/tickets/:userId', auth_1.checkAuth, async (req, res) => res.json(await database_1.DBService.getUserTickets(parseInt(req.authenticatedUserId))));
    app.post('/api/tickets/:userId', auth_1.checkAuth, async (req, res) => {
        const { subject, message } = req.body;
        res.json(await database_1.DBService.createTicket(parseInt(req.authenticatedUserId), subject, message));
    });
    app.get('/api/referral/:userId', auth_1.checkAuth, async (req, res) => {
        const code = await database_1.DBService.ensureReferralCode(parseInt(req.authenticatedUserId));
        const stats = await database_1.DBService.getReferralStats(parseInt(req.authenticatedUserId));
        const botMe = await bot_instance_1.bot.getMe();
        res.json({ code, stats, refLink: `https://t.me/${botMe.username}?start=ref_${code}` });
    });
    app.get('/api/scheduled/:userId', auth_1.checkAuth, async (req, res) => res.json(await database_1.DBService.getUserScheduledPosts(parseInt(req.authenticatedUserId))));
    app.post('/api/scheduled/:userId', auth_1.checkAuth, async (req, res) => {
        const { type, content, scheduledAt } = req.body;
        if (!['video', 'audio', 'text'].includes(type) || !content || !scheduledAt || isNaN(Date.parse(scheduledAt)))
            return res.status(400).json({ error: 'Invalid scheduled post payload' });
        try {
            await database_1.DBService.addScheduledPost(parseInt(req.authenticatedUserId), type, content, scheduledAt);
            res.json({ success: true });
        }
        catch (e) {
            res.status(400).json({ error: 'Invalid scheduled post' });
        }
    });
    app.delete('/api/scheduled/:userId/:id', auth_1.checkAuth, async (req, res) => { await database_1.DBService.cancelScheduledPost(parseInt(req.authenticatedUserId), parseInt(req.params.id)); res.json({ success: true }); });
    app.get('/api/rules/:userId', auth_1.checkAuth, async (req, res) => res.json(await database_1.DBService.getUserRules(parseInt(req.authenticatedUserId))));
    app.post('/api/rules/:userId', auth_1.checkAuth, async (req, res) => {
        const { trigger, condition, action, actionValue } = req.body;
        if (!['keyword', 'source', 'time', 'category'].includes(trigger) || !condition || !action)
            return res.status(400).json({ error: 'Invalid rule payload' });
        const ok = await database_1.DBService.addRule(parseInt(req.authenticatedUserId), trigger, condition, action, actionValue || '');
        res.json({ success: ok });
    });
    app.patch('/api/rules/:userId/:id', auth_1.checkAuth, async (req, res) => {
        const ok = await database_1.DBService.toggleRule(parseInt(req.params.id), req.body.isActive !== false);
        res.json({ success: ok });
    });
    app.delete('/api/rules/:userId/:id', auth_1.checkAuth, async (req, res) => {
        await database_1.DBService.deleteRule(parseInt(req.params.id));
        res.json({ success: true });
    });
    app.get('/api/rules/:userId/suggest', auth_1.checkAuth, async (req, res) => {
        const { RuleEngine } = await Promise.resolve().then(() => __importStar(require('../../services/rule_engine')));
        const suggestions = await RuleEngine.suggestRules(parseInt(req.authenticatedUserId));
        res.json(suggestions);
    });
    app.get('/api/workspaces/:userId', auth_1.checkAuth, async (req, res) => {
        const workspaces = await database_1.DBService.getUserWorkspaces(parseInt(req.authenticatedUserId));
        const result = [];
        for (const ws of workspaces) {
            const channels = await database_1.DBService.getWorkspaceChannels(ws.id);
            result.push({ ...ws, channels });
        }
        res.json(result);
    });
    app.post('/api/workspaces/:userId', auth_1.checkAuth, async (req, res) => {
        const { WorkspaceService } = await Promise.resolve().then(() => __importStar(require('../../services/workspace')));
        const result = await WorkspaceService.createWorkspace(parseInt(req.authenticatedUserId), req.body.name || 'My Workspace');
        res.status(result.error ? 400 : 200).json(result);
    });
    app.post('/api/workspaces/:userId/:id/channel', auth_1.checkAuth, async (req, res) => {
        const { WorkspaceService } = await Promise.resolve().then(() => __importStar(require('../../services/workspace')));
        const result = await WorkspaceService.addChannelToWorkspace(parseInt(req.params.id), req.body.channelId, req.body.name || '');
        res.status(result.error ? 400 : 200).json(result);
    });
    app.delete('/api/workspaces/:userId/:wid/channel/:chId', auth_1.checkAuth, async (req, res) => {
        await database_1.DBService.removeWorkspaceChannel(req.params.chId, parseInt(req.params.wid));
        res.json({ success: true });
    });
    app.post('/api/workspaces/:userId/:id/rebalance', auth_1.checkAuth, async (req, res) => {
        const { WorkspaceService } = await Promise.resolve().then(() => __importStar(require('../../services/workspace')));
        await WorkspaceService.rebalanceContent(parseInt(req.params.id));
        res.json({ success: true });
    });
    app.get('/api/clusters/today', auth_1.checkAuth, async (req, res) => {
        const { ClusteringService } = await Promise.resolve().then(() => __importStar(require('../../services/clustering')));
        const data = await ClusteringService.getClusters(req.query.refresh === '1');
        res.json(data);
    });
    app.post('/api/visual/post', auth_1.checkAuth, async (req, res) => {
        const { VisualBuilder } = await Promise.resolve().then(() => __importStar(require('../../services/visual_builder')));
        const { title, content, sourceUrl, category } = req.body;
        if (!title)
            return res.status(400).json({ error: 'Title required' });
        const image = await VisualBuilder.createPostImage(title, category);
        const caption = VisualBuilder.formatCaption(title, content || '', sourceUrl);
        res.json({ image: image.imageUrl, imageBase64: image.imageBase64, caption });
    });
}
