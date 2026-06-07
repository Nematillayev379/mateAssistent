import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { CONFIG } from '../../config/config';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { logger } from '../../utils/logger';
import { FinanceService } from '../../services/finance';
import { validateKey } from '../../services/ai';
import { checkAuth, checkAdmin } from '../auth';

export function registerSystemRoutes(app: express.Application) {
  app.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok', bot: 'active', uptime: process.uptime() }));

  app.get('/api/redis/status', checkAdmin, async (_req: Request, res: Response) => {
    try {
      const envSet = Boolean(
        (CONFIG.REDIS_URLS && CONFIG.REDIS_URLS.trim()) ||
        (CONFIG.REDIS_URL && CONFIG.REDIS_URL.trim()) ||
        (CONFIG.DEFAULT_REDIS_URL && CONFIG.DEFAULT_REDIS_URL.trim())
      );
      const rawCount =
        (CONFIG.REDIS_URLS ? CONFIG.REDIS_URLS.split(/[,;\n\r]+/).filter(s => s.trim()).length : 0) +
        (CONFIG.REDIS_URL && CONFIG.REDIS_URL.trim() ? 1 : 0) +
        (CONFIG.DEFAULT_REDIS_URL && CONFIG.DEFAULT_REDIS_URL.trim() ? 1 : 0);
      let pool: Record<string, unknown> | null = null;
      try {
        const { getRedisPool } = await import('../../services/redis');
        pool = getRedisPool() as Record<string, unknown> | null;
      } catch {}
      let live = false;
      try {
        const { getRedisConnection } = await import('../../services/redis');
        const conn = await getRedisConnection();
        if (conn) {
          const pong = await conn.ping();
          live = pong === 'PONG';
        }
      } catch {}
      res.json({
        configured: envSet,
        urlsDeclared: rawCount,
        poolInitialized: !!pool,
        poolTotal: (pool?.totalCount as number) || 0,
        poolExhausted: (pool?.exhaustedCount as number) || 0,
        poolActive: pool ? (pool.totalCount as number) - (pool.exhaustedCount as number) : 0,
        activeUrl: pool?.activeUrl ? String(pool.activeUrl).replace(/:[^:@/]+@/, ':***@') : null,
        live,
        mode: envSet && live ? 'redis' : 'in-memory',
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`GET /api/redis/status failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/bot/webhook', rateLimit({ windowMs: 1000, max: 100, keyGenerator: () => 'webhook' }), (req: Request, res: Response) => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (secret !== CONFIG.WEBHOOK_SECRET) return res.sendStatus(403);
    if (!req.body || !req.body.update_id) return res.sendStatus(400);
    res.sendStatus(200);
    setImmediate(async () => {
      try { await bot.processUpdate(req.body); }
      catch (e: unknown) { logger.warn(`Webhook process error: ${e instanceof Error ? e.message : String(e)}`); }
    });
  });

  app.get('/api/finance/prices', checkAuth, async (_req: Request, res: Response) => {
    try { const crypto = await FinanceService.getCryptoPrices(); const usd = await FinanceService.getUSDRate(); res.json({ btc: crypto.BTC || 'N/A', usd: usd || 'N/A' }); }
    catch { res.json({ btc: 'N/A', usd: 'N/A' }); }
  });

  app.get('/api/keys/:userId', checkAuth, async (req: Request, res: Response) => {
    try { res.json(await DBService.getUserApiKeys(parseInt(req.authenticatedUserId as string))); }
    catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/keys/:userId failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.post('/api/keys', checkAdmin, async (req: Request, res: Response) => {
    try {
      const userIdForKey = Number(req.body?.userId || req.authenticatedUserId);
      const { key, type } = req.body;
      if (!userIdForKey || !key || !type || typeof key !== 'string' || typeof type !== 'string') return res.status(400).json({ error: 'Invalid api key payload' });
      if (!(CONFIG.API_KEY_SOURCES as readonly string[]).includes(type)) return res.status(400).json({ error: 'Unsupported API key type' });
      if (!(await validateKey(type as 'openai' | 'google', key))) return res.status(400).json({ error: 'API key validation failed' });
      const { ApiKeyService } = await import('../../services/apiKeys');
      await ApiKeyService.addKey(userIdForKey, type as 'openai' | 'google', key);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/keys failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.post('/api/keys/:userId', checkAdmin, async (req: Request, res: Response) => {
    try {
      const { key, type } = req.body;
      if (!key || !type || typeof key !== 'string' || typeof type !== 'string') return res.status(400).json({ error: 'Invalid api key payload' });
      if (!(CONFIG.API_KEY_SOURCES as readonly string[]).includes(type)) return res.status(400).json({ error: 'Unsupported API key type' });
      if (!(await validateKey(type as 'openai' | 'google', key))) return res.status(400).json({ error: 'API key validation failed' });
      await DBService.addApiKey(parseInt(req.authenticatedUserId as string), key, type);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`POST /api/keys/:userId failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  app.delete('/api/keys/:id', checkAdmin, async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'API key id required' });
      const { ApiKeyService } = await import('../../services/apiKeys');
      await ApiKeyService.removeKey(id);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`DELETE /api/keys/:id failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  const dashboardPages = ['overview', 'sources', 'studio', 'automation', 'settings', 'distribution', 'analytics', 'wallet'];
  for (const page of dashboardPages) {
    app.get(`/dashboard/${page}`, (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'dashboard', `${page}.html`));
    });
  }

  app.get('/dashboard/admin', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'dashboard', 'admin', 'index.html'));
  });

  const adminPages = ['overview', 'users', 'users-approvals', 'ai-keys', 'broadcast', 'broadcast-center', 'system', 'system-config', 'pricing', 'approval-queue'];
  for (const page of adminPages) {
    app.get(`/dashboard/admin/${page}`, (req, res) => {
      res.sendFile(path.join(process.cwd(), 'public', 'dashboard', 'admin', `${page}.html`));
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
    res.sendFile(path.join(process.cwd(), 'public', 'landing.html'));
  });

  app.get('/login', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'login.html'));
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(process.cwd(), 'public', 'landing.html'), (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'Page not found' }); });
  });
}
