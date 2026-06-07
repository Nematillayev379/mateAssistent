import express from 'express';
import os from 'os';
import { DBService } from '../../services/database';
import { logger } from '../../utils/logger';
import { checkAuth } from '../auth';

function safeNum(v: any, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

async function safeGetUserPosts(uid: number, limit: number): Promise<any[]> {
  try {
    const fn = (DBService as any).getUserPosts;
    if (typeof fn !== 'function') return [];
    const r = await fn(uid, limit);
    return Array.isArray(r) ? r : [];
  } catch { return []; }
}

async function safeGetAutoSearches(uid: number): Promise<any[]> {
  try {
    const fn = (DBService as any).getAutoSearches;
    if (typeof fn !== 'function') return [];
    const r = await fn(uid);
    return Array.isArray(r) ? r : [];
  } catch { return []; }
}

export function registerDashboardRoutes(app: express.Application) {
  const processStart = Date.now();

  app.get('/api/overview/:userId', checkAuth, async (req: any, res: any) => {
    try {
      const uid = parseInt(req.authenticatedUserId);
      const user = await DBService.getUser(uid);
      if (!user) return res.status(404).json({ error: 'Not found' });

      const sources = await DBService.getUserSources(uid);
      const activeSources = sources.filter((s: any) => s.is_active !== false).length;
      const posts = await safeGetUserPosts(uid, 50);
      const postsWeek = posts.filter((p: any) => p.created_at && (Date.now() - new Date(p.created_at).getTime()) < 7 * 86400 * 1000).length;

      const userStats = await DBService.getStats(uid).catch(() => ({ total_posts: 0, total_duplicates: 0 })) as any;
      const totalDuplicates = Number(userStats?.total_duplicates) || 0;

      const activity = await safeGetUserPosts(uid, 8);
      const activityFeed = activity.map((p: any) => ({
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
    } catch (e: any) {
      logger.error(`overview error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/studio/:userId', checkAuth, async (req: any, res: any) => {
    try {
      const uid = parseInt(req.authenticatedUserId);
      const posts = await safeGetUserPosts(uid, 50);
      const now = Date.now();
      const dayMs = 86400 * 1000;
      const postsToday = posts.filter((p: any) => p.created_at && (now - new Date(p.created_at).getTime()) < dayMs).length;
      const postsWeek = posts.filter((p: any) => p.created_at && (now - new Date(p.created_at).getTime()) < 7 * dayMs).length;
      const lastAi = posts.find((p: any) => p.ai_used);
      res.json({
        posts_today: postsToday,
        posts_week: postsWeek,
        ai_credits: 100,
        last_ai_use: lastAi && lastAi.created_at ? new Date(lastAi.created_at).toLocaleString('uz-UZ') : '—',
        recent: posts.slice(0, 10).map((p: any) => ({
          title: p.title || (p.text ? String(p.text).substring(0, 60) : '(no title)'),
          time: p.created_at ? new Date(p.created_at).toLocaleString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : '',
          channel: p.target_channel || '',
          status: p.status || 'sent'
        }))
      });
    } catch (e: any) {
      logger.error(`studio error: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/automation/:userId', checkAuth, async (req: any, res: any) => {
    try {
      const uid = parseInt(req.authenticatedUserId);
      const searches = await safeGetAutoSearches(uid);
      const active = searches.filter((s: any) => s.is_active !== false).length;
      res.json({
        active_searches: active,
        total_searches: searches.length,
        runs_today: 0,
        runs_week: 0,
        posts_generated: 0
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/analytics/:userId', checkAuth, async (req: any, res: any) => {
    try {
      const uid = parseInt(req.authenticatedUserId);
      const posts = await safeGetUserPosts(uid, 200);
      const now = new Date();
      const dayMs = 86400 * 1000;
      const dayBuckets = new Array(7).fill(0);
      posts.forEach((p: any) => {
        if (!p.created_at) return;
        const diff = now.getTime() - new Date(p.created_at).getTime();
        const days = Math.floor(diff / dayMs);
        if (days >= 0 && days < 7) dayBuckets[6 - days] += 1;
      });
      const totalViews = posts.reduce((s: number, p: any) => s + (Number(p.views) || 0), 0);
      res.json({
        btc_usd: 0,
        usd_uzs: 0,
        posts_week: posts.filter((p: any) => p.created_at && (now.getTime() - new Date(p.created_at).getTime()) < 7 * dayMs).length,
        total_views: totalViews,
        engagement_pct: 0,
        daily_posts: dayBuckets
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/wallet/:userId', checkAuth, async (req: any, res: any) => {
    try {
      const uid = parseInt(req.authenticatedUserId);
      const user = await DBService.getUser(uid);
      if (!user) return res.status(404).json({ error: 'Not found' });
      const monthly = await DBService.getPrice('monthly').catch(() => 0);
      const yearly = await DBService.getPrice('yearly').catch(() => 0);
      res.json({
        balance: 0,
        plan: user.is_premium ? 'Premium' : 'Free',
        is_premium: !!user.is_premium,
        premium_expires: user.premium_until ? new Date(user.premium_until).toLocaleDateString('uz-UZ') : '—',
        pricing: { monthly, yearly }
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
