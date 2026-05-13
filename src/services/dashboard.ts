import express from 'express';
import { logger } from '../utils/logger';
import { DBService } from './database';
import { CONFIG } from '../config/config';
import { bot, notify, generateDashboardToken } from './bot_instance';
import path from 'path';
import { MusicService } from './music';
import { PaymentService } from './payment';
import { getSmartAIResponse, validateKey, refreshKeyPool } from './ai';
import { ScraperService } from './scraper';

export function startDashboardServer(port: number | string, _bot?: any) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../public')));

  app.get('/health', (req, res) => res.json({ status: 'ok', bot: 'active' }));
  app.post('/api/bot/webhook', async (req, res) => {
    try { await bot.processUpdate(req.body); res.sendStatus(200); } catch (e: any) { res.sendStatus(500); }
  });

  const checkAuth = (req: any, res: any, next: any) => {
    const token = req.headers['x-bot-token'] || req.query.token;
    const userId = req.params.userId || req.query.userId || req.body.userId || req.query.user;
    
    if (!userId || !token) return res.status(401).json({ error: 'Unauthorized' });
    
    // BUG #27 Fix: Validate token against specific userId to prevent IDOR
    if (token !== generateDashboardToken(userId)) {
      return res.status(401).json({ error: 'Invalid token for this user' });
    }
    next();
  };

  const checkAdmin = async (req: any, res: any, next: any) => {
    const token = req.headers['x-bot-token'] || req.query.token;
    // BUG #111 Fix: Robust admin ID extraction
    const adminId = req.headers['x-user-id'] || req.query.userId || req.body.userId || req.query.user;
    
    if (!adminId || !token) return res.status(401).json({ error: 'Unauthorized' });
    if (token !== generateDashboardToken(adminId)) return res.status(401).json({ error: 'Invalid admin token' });
    
    const user = await DBService.getUser(parseInt(adminId as string));
    if (!user || user.role !== 'owner') return res.status(403).json({ error: 'Forbidden: Admin access only' });
    next();
  };

  // --- API ---
  app.get('/api/dashboard-info', checkAuth, async (req, res) => {
    const userId = parseInt((req.query.userId || req.query.user) as string);
    const user = await DBService.getUser(userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json({
      user: { id: user.telegram_id, username: user.username, role: user.role, is_premium: user.is_premium },
      stats: await DBService.getStats(userId),
      scheduled: await DBService.getUserScheduledPosts(userId),
      referrals: await DBService.getReferralStats(userId),
      tickets: (user.role === 'owner' || user.role === 'admin') ? await DBService.getTickets() : await DBService.getUserTickets(userId)
    });
  });

  app.get('/api/user/:userId', checkAuth, async (req, res) => {
    const u = await DBService.getUser(parseInt(req.params.userId));
    res.json(u ? { ...u, api_key_count: await DBService.getUserApiKeyCount(u.telegram_id) } : { error: 'Not found' });
  });

  app.get('/api/sources/:userId', checkAuth, async (req, res) => res.json(await DBService.getUserSources(parseInt(req.params.userId))));

  app.post('/api/sources/:userId', checkAuth, async (req, res) => {
    const uid = parseInt(req.params.userId);
    const { name, url, lang } = req.body;
    
    // BUG #112 Fix: Validate RSS URL before adding
    const discovered = await ScraperService.discoverRSS(url);
    if (!discovered) return res.status(400).json({ error: 'Invalid RSS feed URL' });

    const user = await DBService.getUser(uid);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const sources = await DBService.getUserSources(uid);
    const limit = user.role === 'owner' ? 999 : (user.is_premium ? 3 : 1) + Math.min(await DBService.getUserApiKeyCount(uid), 3);
    if (sources.length >= limit) return res.status(403).json({ error: 'Limit reached' });
    await DBService.addSource(uid, name, discovered, lang || 'uz');
    res.json({ success: true });
  });

  app.delete('/api/sources/:userId/:id', checkAuth, async (req, res) => {
    await DBService.removeSource(parseInt(req.params.userId), parseInt(req.params.id));
    res.json({ success: true });
  });

  app.post('/api/settings/:userId/toggle', checkAuth, async (req, res) => {
    const u = await DBService.getUser(parseInt(req.params.userId));
    if (!u) return res.status(404).json({ error: 'Not found' });
    const next = u.is_active ? 0 : 1;
    await DBService.updateUser(u.telegram_id, { is_active: next });
    res.json({ success: true, is_active: next });
  });

  // --- ADMIN ENDPOINTS (Fix for BUG #4) ---
  app.get('/api/admin/prices', checkAdmin, async (req, res) => res.json({
    monthly: await DBService.getPrice('monthly'),
    yearly: await DBService.getPrice('yearly'),
    stars: await DBService.getSetting('premium_stars_price') || '500'
  }));

  app.post('/api/admin/users/:telegramId/premium', checkAdmin, async (req, res) => {
    // BUG #141 Fix: Ensure days is a number
    const days = parseInt(req.body.days);
    if (isNaN(days) || days < 0) return res.status(400).json({ error: 'Invalid days' });
    
    if (days > 0) {
      await DBService.setPremium(parseInt(req.params.telegramId), days);
    } else {
      await DBService.revokePremium(parseInt(req.params.telegramId));
    }
    res.json({ success: true });
  });

  app.post('/api/admin/users/:telegramId/approve', checkAdmin, async (req, res) => {
    await DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 1 });
    res.json({ success: true });
  });

  app.post('/api/admin/users/:telegramId/block', checkAdmin, async (req, res) => {
    await DBService.updateUser(parseInt(req.params.telegramId), { is_active: 0 });
    res.json({ success: true });
  });

  app.get('/api/admin/system', checkAdmin, async (req, res) => {
    res.json({
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      redis: !!(await import('../services/redis')).getRedisConnection(),
      ownerId: CONFIG.OWNER_ID,
      nodeVersion: process.version
    });
  });

  app.post('/api/admin/broadcast', checkAdmin, async (req, res) => {
    const { message } = req.body;
    const users = await DBService.getAllUsers();
    let count = 0;
    for (const user of users) {
      try {
        await bot.sendMessage(user.telegram_id, message, { parse_mode: 'HTML' });
        count++;
      } catch {}
    }
    res.json({ success: true, sent: count });
  });

  app.get('/api/music/search', checkAuth, async (req, res) => res.json(await MusicService.getYouTubeVideoIds(req.query.q as string, 8)));
  app.get('/api/music/download/:id', checkAuth, async (req, res) => res.redirect(`https://youtube.com/watch?v=${req.params.id}`));

  app.post('/api/ai/smm', checkAuth, async (req, res) => {
    const { prompt, withImage } = req.body;
    const text = await getSmartAIResponse("Write a viral telegram post in Uzbek with emojis.", prompt);
    const imageUrl = withImage ? `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1280&height=720` : null;
    res.json({ text, imageUrl });
  });

  app.post('/api/ai/post-to-channel', checkAuth, async (req, res) => {
    const { userId, text } = req.body;
    const user = await DBService.getUser(parseInt(userId));
    if (user?.target_channel) { await bot.sendMessage(user.target_channel, text, { parse_mode: 'HTML' }); res.json({ success: true }); }
    else res.status(400).json({ error: 'No channel' });
  });

  // BUG #117 Fix: IDOR protection and Stars support
  app.post('/api/premium/buy', checkAuth, async (req, res) => {
    const { userId, method, plan } = req.body;
    const uid = parseInt(userId);
    
    if (method === 'stars') {
      const price = plan === 'yearly' ? 5000 : 500;
      const title = plan === 'yearly' ? 'Elite Premium (1 Year)' : 'Elite Premium (1 Month)';
      const invoice = await bot.createInvoiceLink(
        title, 'Premium access for news automation', 
        `premium_sub_${uid}${plan === 'yearly' ? '_yearly' : ''}`, 
        '', 'XTR', [{ label: 'Premium', amount: price }]
      );
      return res.json({ success: true, url: invoice });
    }
    res.status(400).json({ error: 'Unsupported method' });
  });

  // BUG #134 Fix: Error handling for webhooks
  app.post('/api/payments/payme', async (req, res) => {
    try {
      res.json(await PaymentService.handlePaymeWebhook(req.body, req.headers));
    } catch (e: any) {
      logger.error(`Payme webhook failed: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  app.use('/dashboard', (req, res) => res.sendFile(path.join(__dirname, '../../public/index.html')));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  app.listen(port, () => logger.info(`🖥 Dashboard on ${port}`));
  return app;
}
