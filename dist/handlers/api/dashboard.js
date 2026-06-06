"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDashboardRoutes = registerDashboardRoutes;
const database_1 = require("../../services/database");
const logger_1 = require("../../utils/logger");
const auth_1 = require("../auth");
function safeNum(v, def = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
}
function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0)
        return `${d}d ${h}h ${m}m`;
    if (h > 0)
        return `${h}h ${m}m`;
    return `${m}m`;
}
async function safeGetUserPosts(uid, limit) {
    try {
        const fn = database_1.DBService.getUserPosts;
        if (typeof fn !== 'function')
            return [];
        const r = await fn(uid, limit);
        return Array.isArray(r) ? r : [];
    }
    catch {
        return [];
    }
}
async function safeGetAutoSearches(uid) {
    try {
        const fn = database_1.DBService.getAutoSearches;
        if (typeof fn !== 'function')
            return [];
        const r = await fn(uid);
        return Array.isArray(r) ? r : [];
    }
    catch {
        return [];
    }
}
function registerDashboardRoutes(app) {
    const processStart = Date.now();
    app.get('/api/overview/:userId', auth_1.checkAuth, async (req, res) => {
        try {
            const uid = parseInt(req.authenticatedUserId);
            const user = await database_1.DBService.getUser(uid);
            if (!user)
                return res.status(404).json({ error: 'Not found' });
            const sources = await database_1.DBService.getUserSources(uid);
            const activeSources = sources.filter((s) => s.is_active !== false).length;
            const posts = await safeGetUserPosts(uid, 50);
            const postsWeek = posts.filter((p) => p.created_at && (Date.now() - new Date(p.created_at).getTime()) < 7 * 86400 * 1000).length;
            const userStats = await database_1.DBService.getStats(uid).catch(() => ({ total_posts: 0, total_duplicates: 0 }));
            const totalDuplicates = Number(userStats?.total_duplicates) || 0;
            const activity = await safeGetUserPosts(uid, 8);
            const activityFeed = activity.map((p) => ({
                icon: p.status === 'failed' ? 'error' : (p.ai_used ? 'auto_awesome' : 'send'),
                text: p.title ? p.title.substring(0, 80) : (p.text ? String(p.text).substring(0, 80) : 'Post yuborildi'),
                time: p.created_at ? new Date(p.created_at).toLocaleString('uz-UZ', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : ''
            }));
            const mem = process.memoryUsage();
            const memoryMB = Math.round(mem.heapUsed / 1024 / 1024);
            const capacityPct = Math.min(100, Math.round((mem.heapUsed / mem.heapTotal) * 100));
            res.json({
                total_posts: Number(userStats?.total_posts) || posts.length,
                active_sources: activeSources,
                duplicates_blocked: totalDuplicates,
                ai_requests: 0,
                posts_week: postsWeek,
                memory_mb: memoryMB,
                api_latency_ms: 120,
                capacity_pct: capacityPct,
                bot_status: 'ACTIVE',
                activity: activityFeed
            });
        }
        catch (e) {
            logger_1.logger.error(`overview error: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/studio/:userId', auth_1.checkAuth, async (req, res) => {
        try {
            const uid = parseInt(req.authenticatedUserId);
            const posts = await safeGetUserPosts(uid, 50);
            const now = Date.now();
            const dayMs = 86400 * 1000;
            const postsToday = posts.filter((p) => p.created_at && (now - new Date(p.created_at).getTime()) < dayMs).length;
            const postsWeek = posts.filter((p) => p.created_at && (now - new Date(p.created_at).getTime()) < 7 * dayMs).length;
            const lastAi = posts.find((p) => p.ai_used);
            res.json({
                posts_today: postsToday,
                posts_week: postsWeek,
                ai_credits: 100,
                last_ai_use: lastAi && lastAi.created_at ? new Date(lastAi.created_at).toLocaleString('uz-UZ') : '—',
                recent: posts.slice(0, 10).map((p) => ({
                    title: p.title || (p.text ? String(p.text).substring(0, 60) : '(no title)'),
                    time: p.created_at ? new Date(p.created_at).toLocaleString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : '',
                    channel: p.target_channel || '',
                    status: p.status || 'sent'
                }))
            });
        }
        catch (e) {
            logger_1.logger.error(`studio error: ${e.message}`);
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/automation/:userId', auth_1.checkAuth, async (req, res) => {
        try {
            const uid = parseInt(req.authenticatedUserId);
            const searches = await safeGetAutoSearches(uid);
            const active = searches.filter((s) => s.is_active !== false).length;
            res.json({
                active_searches: active,
                total_searches: searches.length,
                runs_today: 0,
                runs_week: 0,
                posts_generated: 0
            });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/analytics/:userId', auth_1.checkAuth, async (req, res) => {
        try {
            const uid = parseInt(req.authenticatedUserId);
            const posts = await safeGetUserPosts(uid, 200);
            const now = new Date();
            const dayMs = 86400 * 1000;
            const dayBuckets = new Array(7).fill(0);
            posts.forEach((p) => {
                if (!p.created_at)
                    return;
                const diff = now.getTime() - new Date(p.created_at).getTime();
                const days = Math.floor(diff / dayMs);
                if (days >= 0 && days < 7)
                    dayBuckets[6 - days] += 1;
            });
            const totalViews = posts.reduce((s, p) => s + (Number(p.views) || 0), 0);
            res.json({
                btc_usd: 0,
                usd_uzs: 0,
                posts_week: posts.filter((p) => p.created_at && (now.getTime() - new Date(p.created_at).getTime()) < 7 * dayMs).length,
                total_views: totalViews,
                engagement_pct: 0,
                daily_posts: dayBuckets
            });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.get('/api/wallet/:userId', auth_1.checkAuth, async (req, res) => {
        try {
            const uid = parseInt(req.authenticatedUserId);
            const user = await database_1.DBService.getUser(uid);
            if (!user)
                return res.status(404).json({ error: 'Not found' });
            const monthly = await database_1.DBService.getPrice('monthly').catch(() => 0);
            const yearly = await database_1.DBService.getPrice('yearly').catch(() => 0);
            res.json({
                balance: 0,
                plan: user.is_premium ? 'Premium' : 'Free',
                is_premium: !!user.is_premium,
                premium_expires: user.premium_expires ? new Date(user.premium_expires).toLocaleDateString('uz-UZ') : '—',
                pricing: { monthly, yearly }
            });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
}
