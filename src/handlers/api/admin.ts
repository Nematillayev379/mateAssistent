import express from 'express';
import rateLimit from 'express-rate-limit';
import { CONFIG, isOwnerId, buildKeyPoolFromEnv, countKeysByProvider, getEnvKeySourceReport } from '../../config/config';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { logger } from '../../utils/logger';
import { refreshKeyPool, getActiveKeyStats } from '../../services/ai';
import { checkAdmin } from '../auth';

export function registerAdminRoutes(app: express.Application) {
  const adminAiLimiter = rateLimit({
    windowMs: 60 * 1000, max: 30, message: { error: 'Admin AI request limit exceeded.' }
  });

  app.get('/api/admin/users', checkAdmin, async (req, res) => {
    const users = await DBService.getAllUsers();
    for (const u of users) u.sources = await DBService.getUserSources(u.telegram_id);
    res.json(users);
  });

  app.get('/api/admin/settings', checkAdmin, async (req, res) => {
    res.json({
      premium_stars_price: await DBService.getSetting('premium_stars_price') || '500',
      price_monthly: await DBService.getPrice('monthly'),
      price_yearly: await DBService.getPrice('yearly'),
      require_approval: (await DBService.getSetting('require_approval')) !== '0',
    });
  });

  app.post('/api/admin/settings', checkAdmin, async (req, res) => {
    const { premium_stars_price, price_monthly, price_yearly, require_approval } = req.body;
    if (premium_stars_price) await DBService.setSetting('premium_stars_price', String(premium_stars_price));
    if (price_monthly) await DBService.setPrice('monthly', Number(price_monthly));
    if (price_yearly) await DBService.setPrice('yearly', Number(price_yearly));
    if (require_approval !== undefined) await DBService.setSetting('require_approval', require_approval ? '1' : '0');
    res.json({ success: true });
  });

  app.post('/api/admin/users/:telegramId/role', checkAdmin, async (req: any, res: any) => {
    const role = req.body.role;
    if (!['owner', 'admin', 'user', 'premium'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
    const callerId = parseInt(req.authenticatedUserId);
    if ((role === 'owner' || role === 'admin') && !isOwnerId(callerId)) return res.status(403).json({ error: 'Faqat Owner boshqalarni admin qila oladi' });
    if (role === 'owner') return res.status(403).json({ error: 'Owner rolini API orqali berish taqiqlangan' });
    await DBService.updateUserRole(parseInt(req.params.telegramId), role);
    res.json({ success: true });
  });

  app.get('/api/admin/prices', checkAdmin, async (req, res) => res.json({ monthly: await DBService.getPrice('monthly'), yearly: await DBService.getPrice('yearly'), stars: await DBService.getSetting('premium_stars_price') || '500' }));

  app.post('/api/admin/users/:telegramId/premium', checkAdmin, async (req, res) => {
    const days = parseInt(req.body.days);
    if (isNaN(days) || days < 0) return res.status(400).json({ error: 'Invalid days' });
    if (days > 0) await DBService.setPremium(parseInt(req.params.telegramId), days);
    else await DBService.revokePremium(parseInt(req.params.telegramId));
    res.json({ success: true });
  });

  app.post('/api/admin/users/:telegramId/approve', checkAdmin, async (req, res) => { await DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 1 }); res.json({ success: true }); });
  app.post('/api/admin/users/:telegramId/block', checkAdmin, async (req, res) => { await DBService.updateUser(parseInt(req.params.telegramId), { is_active: 0 }); res.json({ success: true }); });
  app.post('/api/admin/users/:telegramId/unblock', checkAdmin, async (req, res) => { await DBService.updateUser(parseInt(req.params.telegramId), { is_active: 1 }); res.json({ success: true }); });
  app.post('/api/admin/users/:telegramId/reject', checkAdmin, async (req, res) => { await DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 0 }); res.json({ success: true }); });
  app.post('/api/admin/users/:telegramId/revoke', checkAdmin, async (req, res) => { await DBService.revokePremium(parseInt(req.params.telegramId)); res.json({ success: true }); });

  app.post('/api/admin/users/approve-all', checkAdmin, async (req, res) => {
    try {
      const users = await DBService.getAllUsers();
      const pending = users.filter((u: any) => !u.is_approved && u.is_active !== false);
      for (const u of pending) {
        await DBService.updateUser(u.telegram_id, { is_approved: 1 });
      }
      res.json({ success: true, approved: pending.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/admin/sources', checkAdmin, async (req, res) => res.json(await DBService.getAllSources()));

  app.get('/api/admin/system', checkAdmin, async (req, res) => {
    const { getRedisPool } = await import('../../services/redis');
    const pool = getRedisPool();
    let redisStatus = false;
    let poolInfo = null;
    if (pool) {
      try { await pool.active.ping(); redisStatus = true; } catch (e: any) { logger.warn(`Redis ping failed: ${e?.message || 'unknown error'}`); }
      poolInfo = { active: pool.exhaustedCount + 1, total: pool.totalCount, exhausted: pool.exhaustedCount, url: pool.activeUrl.replace(/:\/\/.*@/, '://***@') };
    }
    const envPool = buildKeyPoolFromEnv();
    const active = getActiveKeyStats();
    const mem = process.memoryUsage();
    const memPct = Math.min(99, Math.round((mem.heapUsed / mem.heapTotal) * 100));
    let userCount = 0, sourceCount = 0, postCount = 0, pendingUsers = 0, premiumUsers = 0, freeUsers = 0;
    try {
      const allUsers = await DBService.getAllUsers();
      userCount = allUsers.length;
      pendingUsers = allUsers.filter((u: any) => !u.is_approved && u.is_active !== false).length;
      premiumUsers = allUsers.filter((u: any) => u.is_premium).length;
      freeUsers = userCount - premiumUsers;
    } catch (e: any) { logger.warn('getAllUsers failed: ' + e?.message); }
    try {
      const allSources = await DBService.getAllSources();
      sourceCount = allSources.length;
    } catch (e: any) { logger.warn('getAllSources failed: ' + e?.message); }
    res.json({
      uptime: process.uptime(),
      memory: mem,
      memory_usage: Math.round(mem.heapUsed / 1024 / 1024) + ' MB',
      memory_pct: memPct,
      redis: redisStatus,
      redisPool: poolInfo,
      nodeVersion: process.version,
      version: process.env.npm_package_version || '1.0.0',
      user_count: userCount,
      source_count: sourceCount,
      post_count: postCount,
      pending_users: pendingUsers,
      premium_users: premiumUsers,
      free_users: freeUsers,
      uptime_pct: '99.8',
      aiKeys: { envLoaded: envPool.length, activeLoaded: active.total, envByProvider: countKeysByProvider(envPool), activeByProvider: active.byProvider, envVarCounts: getEnvKeySourceReport() }
    });
  });

  app.get('/api/admin/stats', checkAdmin, async (req, res) => {
    try {
      const allUsers = await DBService.getAllUsers();
      const total_users = allUsers.length;
      const premium_users = allUsers.filter((u: any) => u.is_premium).length;
      const free_users = total_users - premium_users;
      const pending_users = allUsers.filter((u: any) => !u.is_approved && u.is_active !== false).length;
      const source_count = (await DBService.getAllSources().catch(() => [])).length;
      res.json({
        total_users, premium_users, free_users, pending_users,
        source_count,
        posts_today: 0,
        revenue_month: (premium_users * 25000).toLocaleString() + ' UZS',
        uptime_pct: '99.8'
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/ai-keys/refresh', checkAdmin, async (_req, res) => { await refreshKeyPool(); res.json({ success: true, ...getActiveKeyStats() }); });

  app.get('/api/admin/ai-keys', checkAdmin, async (_req, res) => {
    try {
      const stats = getActiveKeyStats();
      const envPool: any[] = buildKeyPoolFromEnv() as any[];
      const providers: any = {};
      let total = 0, active = 0, blocked = 0;
      for (const k of envPool) {
        const prov = k.provider || 'unknown';
        if (!providers[prov]) providers[prov] = { active: 0, blocked: 0, total: 0 };
        providers[prov].total += 1;
        total += 1;
        if (k.status === 'active' || k.status === 'valid') {
          providers[prov].active += 1;
          active += 1;
        } else {
          providers[prov].blocked += 1;
          blocked += 1;
        }
      }
      const keys = envPool.slice(0, 50).map((k: any, i: number) => ({
        id: k.id || `key-${i}`,
        name: k.name || k.id || `Key ${i+1}`,
        provider: k.provider || 'unknown',
        status: k.status || 'unknown',
        usage: k.usage || 0,
        last_used: k.lastUsed || k.last_used || '—'
      }));
      res.json({ total, active, blocked, providers, keys, stats });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/broadcast', checkAdmin, adminAiLimiter, async (req: any, res: any) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Invalid broadcast message' });
    const users = await DBService.getAllUsers();
    const queued = users.length;
    setImmediate(async () => {
      let count = 0;
      for (const user of users) {
        try { await bot.sendMessage(user.telegram_id, message, { parse_mode: 'HTML' }); count++; await new Promise(r => setTimeout(r, 40)); }
        catch (e: any) { logger.warn(`Broadcast failed for ${user.telegram_id}: ${e.message}`); }
      }
      logger.info(`Broadcast finished: ${count}/${queued} messages sent.`);
    });
    res.status(202).json({ success: true, queued });
  });
}
