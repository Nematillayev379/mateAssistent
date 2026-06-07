import express, { Request, Response } from 'express';
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

  app.get('/api/admin/users', checkAdmin, async (_req: Request, res: Response) => {
    try {
      const users = await DBService.getAllUsers();
      for (const u of users) u.sources = await DBService.getUserSources(u.telegram_id);
      res.json(users);
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/admin/users failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.get('/api/admin/settings', checkAdmin, async (_req: Request, res: Response) => {
    try {
      res.json({
        premium_stars_price: await DBService.getSetting('premium_stars_price') || '500',
        price_monthly: await DBService.getPrice('monthly'),
        price_yearly: await DBService.getPrice('yearly'),
        require_approval: (await DBService.getSetting('require_approval')) !== '0',
      });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/admin/settings failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.post('/api/admin/settings', checkAdmin, async (req: Request, res: Response) => {
    try {
      const { premium_stars_price, price_monthly, price_yearly, require_approval } = req.body;
      if (premium_stars_price) await DBService.setSetting('premium_stars_price', String(premium_stars_price));
      if (price_monthly) await DBService.setPrice('monthly', Number(price_monthly));
      if (price_yearly) await DBService.setPrice('yearly', Number(price_yearly));
      if (require_approval !== undefined) await DBService.setSetting('require_approval', require_approval ? '1' : '0');
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/admin/settings failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.post('/api/admin/users/:telegramId/role', checkAdmin, async (req: Request, res: Response) => {
    try {
      const role = req.body.role;
      if (!['owner', 'admin', 'user', 'premium'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
      const callerId = parseInt(req.authenticatedUserId as string);
      if ((role === 'owner' || role === 'admin') && !isOwnerId(callerId)) return res.status(403).json({ error: 'Faqat Owner boshqalarni admin qila oladi' });
      if (role === 'owner') return res.status(403).json({ error: 'Owner rolini API orqali berish taqiqlangan' });
      await DBService.updateUserRole(parseInt(req.params.telegramId as string), role);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/admin/users/:telegramId/role failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.get('/api/admin/prices', checkAdmin, async (_req: Request, res: Response) => {
    try { res.json({ monthly: await DBService.getPrice('monthly'), yearly: await DBService.getPrice('yearly'), stars: await DBService.getSetting('premium_stars_price') || '500' }); }
    catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/admin/prices failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.post('/api/admin/users/:telegramId/premium', checkAdmin, async (req: Request, res: Response) => {
    try {
      const days = parseInt(req.body.days);
      if (isNaN(days) || days < 0) return res.status(400).json({ error: 'Invalid days' });
      if (days > 0) await DBService.setPremium(parseInt(req.params.telegramId as string), days);
      else await DBService.revokePremium(parseInt(req.params.telegramId as string));
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/admin/users/:telegramId/premium failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.post('/api/admin/users/:telegramId/approve', checkAdmin, async (req: Request, res: Response) => { try { await DBService.updateUser(parseInt(req.params.telegramId as string), { is_approved: 1 }); res.json({ success: true }); } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/admin/users/:telegramId/approve failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); } });
  app.post('/api/admin/users/:telegramId/block', checkAdmin, async (req: Request, res: Response) => { try { await DBService.updateUser(parseInt(req.params.telegramId as string), { is_active: 0 }); res.json({ success: true }); } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/admin/users/:telegramId/block failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); } });
  app.post('/api/admin/users/:telegramId/unblock', checkAdmin, async (req: Request, res: Response) => { try { await DBService.updateUser(parseInt(req.params.telegramId as string), { is_active: 1 }); res.json({ success: true }); } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/admin/users/:telegramId/unblock failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); } });
  app.post('/api/admin/users/:telegramId/reject', checkAdmin, async (req: Request, res: Response) => { try { await DBService.updateUser(parseInt(req.params.telegramId as string), { is_approved: 0 }); res.json({ success: true }); } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/admin/users/:telegramId/reject failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); } });
  app.post('/api/admin/users/:telegramId/revoke', checkAdmin, async (req: Request, res: Response) => { try { await DBService.revokePremium(parseInt(req.params.telegramId as string)); res.json({ success: true }); } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/admin/users/:telegramId/revoke failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); } });

  app.post('/api/admin/users/approve-all', checkAdmin, async (_req: Request, res: Response) => {
    try {
      const users = await DBService.getAllUsers();
      const pending = users.filter((u: Record<string, unknown>) => !u.is_approved && u.is_active !== false);
      for (const u of pending) {
        await DBService.updateUser(u.telegram_id as number, { is_approved: 1 });
      }
      res.json({ success: true, approved: pending.length });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/admin/users/approve-all failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.get('/api/admin/sources', checkAdmin, async (_req: Request, res: Response) => {
    try { res.json(await DBService.getAllSources()); }
    catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/admin/sources failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.get('/api/admin/system', checkAdmin, async (_req: Request, res: Response) => {
    try {
      const { getRedisPool } = await import('../../services/redis');
      const pool = getRedisPool();
      let redisStatus = false;
      let poolInfo: Record<string, unknown> | null = null;
      if (pool) {
        try { await pool.active.ping(); redisStatus = true; } catch (e: unknown) { logger.warn(`Redis ping failed: ${e instanceof Error ? e.message : 'unknown error'}`); }
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
        pendingUsers = allUsers.filter((u: Record<string, unknown>) => !u.is_approved && u.is_active !== false).length;
        premiumUsers = allUsers.filter((u: Record<string, unknown>) => u.is_premium).length;
        freeUsers = userCount - premiumUsers;
      } catch (e: unknown) { logger.warn('getAllUsers failed: ' + (e instanceof Error ? e.message : String(e))); }
      try {
        const allSources = await DBService.getAllSources();
        sourceCount = allSources.length;
      } catch (e: unknown) { logger.warn('getAllSources failed: ' + (e instanceof Error ? e.message : String(e))); }
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
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/admin/system failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.get('/api/admin/stats', checkAdmin, async (_req: Request, res: Response) => {
    try {
      const allUsers = await DBService.getAllUsers();
      const total_users = allUsers.length;
      const premium_users = allUsers.filter((u: Record<string, unknown>) => u.is_premium).length;
      const free_users = total_users - premium_users;
      const pending_users = allUsers.filter((u: Record<string, unknown>) => !u.is_approved && u.is_active !== false).length;
      const source_count = (await DBService.getAllSources().catch(() => [])).length;
      res.json({
        total_users, premium_users, free_users, pending_users,
        source_count,
        posts_today: 0,
        revenue_month: (premium_users * 25000).toLocaleString() + ' UZS',
        uptime_pct: '99.8'
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`GET /api/admin/stats failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/admin/ai-keys/refresh', checkAdmin, async (_req: Request, res: Response) => { try { await refreshKeyPool(); res.json({ success: true, ...getActiveKeyStats() }); } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/admin/ai-keys/refresh failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); } });

  app.get('/api/admin/ai-keys', checkAdmin, async (_req: Request, res: Response) => {
    try {
      const stats = getActiveKeyStats();
      const envPool: Array<Record<string, unknown>> = buildKeyPoolFromEnv() as Array<Record<string, unknown>>;
      const providers: Record<string, { active: number; blocked: number; total: number }> = {};
      let total = 0, active = 0, blocked = 0;
      for (const k of envPool) {
        const prov = (k.provider as string) || 'unknown';
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
      const keys = envPool.slice(0, 50).map((k: Record<string, unknown>, i: number) => ({
        id: k.id || `key-${i}`,
        name: k.name || k.id || `Key ${i+1}`,
        provider: k.provider || 'unknown',
        status: k.status || 'unknown',
        usage: k.usage || 0,
        last_used: k.lastUsed || k.last_used || '—'
      }));
      res.json({ total, active, blocked, providers, keys, stats });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`GET /api/admin/ai-keys failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/admin/broadcast', checkAdmin, adminAiLimiter, async (req: Request, res: Response) => {
    try {
      const { message } = req.body;
      if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Invalid broadcast message' });
      const users = await DBService.getAllUsers();
      const queued = users.length;
      setImmediate(async () => {
        let count = 0;
        for (const user of users) {
          try { await bot.sendMessage(user.telegram_id, message, { parse_mode: 'HTML' }); count++; await new Promise(r => setTimeout(r, 40)); }
          catch (e: unknown) { logger.warn(`Broadcast failed for ${user.telegram_id}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        logger.info(`Broadcast finished: ${count}/${queued} messages sent.`);
      });
      res.status(202).json({ success: true, queued });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/admin/broadcast failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });
}
