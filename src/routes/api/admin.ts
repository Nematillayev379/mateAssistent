import express from 'express';
import rateLimit from 'express-rate-limit';
import { CONFIG, isOwnerId, buildKeyPoolFromEnv, countKeysByProvider, getEnvKeySourceReport } from '../../config/config';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { logger } from '../../utils/logger';
import { refreshKeyPool, getActiveKeyStats } from '../../services/ai';
import { checkAdmin } from '../../middleware/auth';

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
    res.json({ premium_stars_price: await DBService.getSetting('premium_stars_price') || '500', price_monthly: await DBService.getPrice('monthly'), price_yearly: await DBService.getPrice('yearly') });
  });

  app.post('/api/admin/settings', checkAdmin, async (req, res) => {
    const { premium_stars_price, price_monthly, price_yearly } = req.body;
    if (premium_stars_price) await DBService.setSetting('premium_stars_price', String(premium_stars_price));
    if (price_monthly) await DBService.setPrice('monthly', Number(price_monthly));
    if (price_yearly) await DBService.setPrice('yearly', Number(price_yearly));
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

  app.get('/api/admin/sources', checkAdmin, async (req, res) => res.json(await DBService.getAllSources()));

  app.get('/api/admin/system', checkAdmin, async (req, res) => {
    const { getRedisPool } = await import('../../services/redis');
    const pool = getRedisPool();
    let redisStatus = false;
    let poolInfo = null;
    if (pool) {
      try { await pool.active.ping(); redisStatus = true; } catch {}
      poolInfo = { active: pool.exhaustedCount + 1, total: pool.totalCount, exhausted: pool.exhaustedCount, url: pool.activeUrl.replace(/:\/\/.*@/, '://***@') };
    }
    const envPool = buildKeyPoolFromEnv();
    const active = getActiveKeyStats();
    res.json({ uptime: process.uptime(), memory: process.memoryUsage(), redis: redisStatus, redisPool: poolInfo, nodeVersion: process.version, aiKeys: { envLoaded: envPool.length, activeLoaded: active.total, envByProvider: countKeysByProvider(envPool), activeByProvider: active.byProvider, envVarCounts: getEnvKeySourceReport() } });
  });

  app.post('/api/admin/ai-keys/refresh', checkAdmin, async (_req, res) => { await refreshKeyPool(); res.json({ success: true, ...getActiveKeyStats() }); });

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
