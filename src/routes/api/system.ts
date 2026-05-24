import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { CONFIG } from '../../config/config';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { logger } from '../../utils/logger';
import { FinanceService } from '../../services/finance';
import { validateKey } from '../../services/ai';
import { checkAuth, checkAdmin } from '../../middleware/auth';

export function registerSystemRoutes(app: express.Application) {
  app.get('/health', (req, res) => res.json({ status: 'ok', bot: 'active', uptime: process.uptime() }));

  app.post('/api/bot/webhook', rateLimit({ windowMs: 1000, max: 100, keyGenerator: () => 'webhook' }), (req, res) => {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (secret !== CONFIG.WEBHOOK_SECRET) return res.sendStatus(403);
    if (!req.body || !req.body.update_id) return res.sendStatus(400);
    res.sendStatus(200);
    setImmediate(async () => {
      try { await bot.processUpdate(req.body); }
      catch (e: any) { logger.warn(`Webhook process error: ${e.message}`); }
    });
  });

  app.get('/api/finance/prices', checkAuth, async (req, res) => {
    try { const crypto = await FinanceService.getCryptoPrices(); const usd = await FinanceService.getUSDRate(); res.json({ btc: crypto.BTC || 'N/A', usd: usd || 'N/A' }); }
    catch { res.json({ btc: 'N/A', usd: 'N/A' }); }
  });

  app.get('/api/keys/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserApiKeys(parseInt(req.authenticatedUserId))));
  app.post('/api/keys', checkAdmin, async (req: any, res: any) => {
    const userIdForKey = Number(req.body?.userId || req.authenticatedUserId);
    const { key, type } = req.body;
    if (!userIdForKey || !key || !type || typeof key !== 'string' || typeof type !== 'string') return res.status(400).json({ error: 'Invalid api key payload' });
    if (!(CONFIG.API_KEY_SOURCES as readonly string[]).includes(type)) return res.status(400).json({ error: 'Unsupported API key type' });
    if (!(await validateKey(type as any, key))) return res.status(400).json({ error: 'API key validation failed' });
    const { ApiKeyService } = await import('../../services/apiKeys');
    await ApiKeyService.addKey(userIdForKey, type as any, key);
    res.json({ success: true });
  });
  app.post('/api/keys/:userId', checkAdmin, async (req: any, res: any) => {
    const { key, type } = req.body;
    if (!key || !type || typeof key !== 'string' || typeof type !== 'string') return res.status(400).json({ error: 'Invalid api key payload' });
    if (!(CONFIG.API_KEY_SOURCES as readonly string[]).includes(type)) return res.status(400).json({ error: 'Unsupported API key type' });
    if (!(await validateKey(type as any, key))) return res.status(400).json({ error: 'API key validation failed' });
    await DBService.addApiKey(parseInt(req.authenticatedUserId), key, type);
    res.json({ success: true });
  });
  app.delete('/api/keys/:id', checkAdmin, async (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!id || Number.isNaN(id)) return res.status(400).json({ error: 'API key id required' });
    const { ApiKeyService } = await import('../../services/apiKeys');
    await ApiKeyService.removeKey(id);
    res.json({ success: true });
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
    const search = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    res.redirect(`/dashboard/overview${search}`);
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'), (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'Page not found' }); });
  });
}
