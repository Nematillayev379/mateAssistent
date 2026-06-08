import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { CONFIG } from '../../config/config';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { grammyBot } from '../../services/grammy-bot';
import { logger } from '../../utils/logger';
import { FinanceService } from '../../services/finance';
import { validateKey } from '../../services/ai';
import { checkAuth, checkAdmin } from '../auth';

export function registerSystemRoutes(app: express.Application) {
  /**
   * @swagger
   * /health:
   *   get:
   *     tags: [System]
   *     summary: Health check
   *     description: Returns bot status and uptime
   *     operationId: getHealth
   *     responses:
   *       200:
   *         description: Service is healthy
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 status:
   *                   type: string
   *                 bot:
   *                   type: string
   *                 uptime:
   *                   type: number
   *       401:
   *         description: Unauthorized
   */
  app.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok', bot: 'active', uptime: process.uptime() }));

  app.get('/api/debug/webhook', async (_req: Request, res: Response) => {
    try {
      const whInfo = await grammyBot.api.getWebhookInfo();
      res.json({
        url: whInfo.url,
        has_custom_certificate: whInfo.has_custom_certificate,
        pending_update_count: whInfo.pending_update_count,
        last_error_date: whInfo.last_error_date,
        last_error_message: whInfo.last_error_message,
        max_connections: whInfo.max_connections,
        secret_configured: !!CONFIG.WEBHOOK_SECRET,
        secret_len: CONFIG.WEBHOOK_SECRET?.length,
      });
    } catch (e: unknown) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /**
   * @swagger
   * /api/redis/status:
   *   get:
   *     tags: [System]
   *     summary: Get Redis connection status
   *     description: Returns Redis pool configuration, connection state, and mode (redis or in-memory)
   *     operationId: getRedisStatus
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     responses:
   *       200:
   *         description: Redis status details
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 configured:
   *                   type: boolean
   *                 live:
   *                   type: boolean
   *                 mode:
   *                   type: string
   *       401:
   *         description: Unauthorized
   */
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

  /**
   * @swagger
   * /api/bot/webhook:
   *   post:
   *     tags: [System]
   *     summary: Telegram bot webhook endpoint
   *     description: Receives Telegram updates via webhook. Secured with x-telegram-bot-api-secret-token header.
   *     operationId: postBotWebhook
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               update_id:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Update processed
   *       403:
   *         description: Invalid secret token
   *       400:
   *         description: Invalid payload
   */
  app.post('/api/bot/webhook', rateLimit({ windowMs: 1000, max: 100, keyGenerator: () => 'webhook' }), async (req: Request, res: Response) => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (secret !== CONFIG.WEBHOOK_SECRET) {
      logger.warn(`Webhook 403: secret mismatch (got: "${secret}", expected len: ${CONFIG.WEBHOOK_SECRET?.length})`);
      return res.sendStatus(403);
    }
    if (!req.body || !req.body.update_id) {
      logger.warn(`Webhook 400: missing update_id (body: ${JSON.stringify(req.body)?.slice(0, 200)})`);
      return res.sendStatus(400);
    }

    try {
      if (grammyBot) {
        await grammyBot.handleUpdate(req.body);
      } else {
        await bot.processUpdate(req.body);
      }
      res.sendStatus(200);
    } catch (e: unknown) {
      logger.error(`Webhook process error: ${e instanceof Error ? e.message : String(e)}`, { stack: e instanceof Error ? e.stack : undefined });
      res.sendStatus(200);
    }
  });

  /**
   * @swagger
   * /api/finance/prices:
   *   get:
   *     tags: [System]
   *     summary: Get crypto and USD prices
   *     description: Returns current BTC and USD exchange rate
   *     operationId: getFinancePrices
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     responses:
   *       200:
   *         description: Price data
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 btc:
   *                   type: string
   *                 usd:
   *                   type: string
   *       401:
   *         description: Unauthorized
   */
  app.get('/api/finance/prices', checkAuth, async (_req: Request, res: Response) => {
    try { const crypto = await FinanceService.getCryptoPrices(); const usd = await FinanceService.getUSDRate(); res.json({ btc: crypto.BTC || 'N/A', usd: usd || 'N/A' }); }
    catch { res.json({ btc: 'N/A', usd: 'N/A' }); }
  });

  /**
   * @swagger
   * /api/keys/{userId}:
   *   get:
   *     tags: [System]
   *     summary: Get user API keys
   *     description: Returns all API keys for a user
   *     operationId: getUserApiKeys
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: List of API keys
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *       401:
   *         description: Unauthorized
   */
  app.get('/api/keys/:userId', checkAuth, async (req: Request, res: Response) => {
    try { res.json(await DBService.getUserApiKeys(parseInt(req.authenticatedUserId as string))); }
    catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`GET /api/keys/:userId failed: ${msg}`); res.status(500).json({ error: 'Internal error' }); }
  });

  /**
   * @swagger
   * /api/keys:
   *   post:
   *     tags: [System]
   *     summary: Add an API key
   *     description: Validates and adds an API key for a user
   *     operationId: addApiKey
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [key, type]
   *             properties:
   *               userId:
   *                 type: number
   *               key:
   *                 type: string
   *               type:
   *                 type: string
   *                 enum: [openai, google]
   *     responses:
   *       200:
   *         description: Key added
   *       400:
   *         description: Invalid key payload
   *       401:
   *         description: Unauthorized
   */
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

  /**
   * @swagger
   * /api/keys/{userId}:
   *   post:
   *     tags: [System]
   *     summary: Add API key for specific user
   *     description: Validates and adds an API key for a specific user
   *     operationId: addApiKeyForUser
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [key, type]
   *             properties:
   *               key:
   *                 type: string
   *               type:
   *                 type: string
   *                 enum: [openai, google]
   *     responses:
   *       200:
   *         description: Key added
   *       400:
   *         description: Invalid key payload
   *       401:
   *         description: Unauthorized
   */
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

  /**
   * @swagger
   * /api/keys/{id}:
   *   delete:
   *     tags: [System]
   *     summary: Delete an API key
   *     description: Removes an API key by its ID
   *     operationId: deleteApiKey
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Key deleted
   *       400:
   *         description: Invalid key ID
   *       401:
   *         description: Unauthorized
   */
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
