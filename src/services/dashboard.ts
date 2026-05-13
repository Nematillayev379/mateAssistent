import express from 'express';
import { logger } from '../utils/logger';
import { DBService } from './database';
import { CONFIG } from '../config/config';
import { bot, notify } from './bot_instance';
import path from 'path';
import crypto from 'crypto';
import { PriceTrackerService } from './pricetracker';
import { getSmartAIResponse, validateKey, refreshKeyPool } from './ai';
import { downloadYouTube } from './youtube';
import { MusicService } from './music';
import { PaymentService } from './payment';

export function startDashboardServer(port: number | string, _bot?: any) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../../public')));

  app.get('/health', (req, res) => res.json({ status: 'ok', bot: 'active', mode: CONFIG.PUBLIC_URL ? 'webhook' : 'polling' }));
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../../public/index.html')));

  // ── BOT WEBHOOK ──────────────────────────────────────────────
  app.post('/api/bot/webhook', async (req, res) => {
    try {
      bot.processUpdate(req.body);
      res.sendStatus(200);
    } catch (e: any) {
      logger.error(`Webhook error: ${e.message}`);
      res.sendStatus(500);
    }
  });

  const DASHBOARD_SECRET = CONFIG.DASHBOARD_SECRET || 'fallback-secret-123';

  const checkAuth = (req: any, res: any, next: any) => {
    const token = req.headers['x-bot-token'] || req.query.token;
    if (!token || token !== DASHBOARD_SECRET) {
      logger.warn(`🚫 Unauthorized API access attempt from ${req.ip}`);
      return res.status(401).json({ error: 'Unauthorized: Invalid Token' });
    }
    next();
  };

  const checkAdmin = async (req: any, res: any, next: any) => {
    const token = req.headers['x-bot-token'] || req.query.token;
    if (!token || token !== DASHBOARD_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // For admin routes, we must verify the user making the request is an owner
    const requesterId = req.headers['x-user-id'] || req.query.user_id || req.body.userId;
    if (!requesterId) {
      return res.status(403).json({ error: 'Forbidden: user_id required for admin check' });
    }

    const user = await DBService.getUser(parseInt(requesterId as string)).catch(() => null);
    if (!user || !user.is_owner) {
      logger.warn(`🚫 Non-admin access attempt to admin route: ${requesterId}`);
      return res.status(403).json({ error: 'Forbidden: Admin access only' });
    }
    next();
  };

  // ── USER ────────────────────────────────────────────────────────
  app.get('/api/user/:userId', checkAuth, async (req, res) => {
    try {
      const user = await DBService.getUser(parseInt(req.params.userId));
      if (!user) return res.status(404).json({ error: 'User not found' });
      const keyCount = await DBService.getUserApiKeyCount(parseInt(req.params.userId));
      res.json({ ...user, api_key_count: keyCount });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/users', checkAdmin, async (req: any, res: any) => {
    try {
      const users = await DBService.getAllUsers();
      res.json(users);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── STATS ─────────────────────────────────────────────────────
  app.get('/api/stats/:userId', checkAuth, async (req, res) => {
    try {
      const stats = await DBService.getStats(parseInt(req.params.userId));
      res.json(stats || { total_posts: 0, total_duplicates: 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── SOURCES ───────────────────────────────────────────────────
  app.get('/api/sources/:userId', checkAuth, async (req, res) => {
    try {
      const sources = await DBService.getUserSources(parseInt(req.params.userId));
      res.json(sources);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/sources/:userId', checkAuth, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { name, url, lang } = req.body;

      if (!name || !url) {
        return res.status(400).json({ error: 'Nom va URL kiritilishi shart' });
      }

      // Source limit logic
      const user = await DBService.getUser(userId);
      if (!user) return res.status(404).json({ error: 'Foydalanuvchi topilmadi' });

      const sources = await DBService.getUserSources(userId);
      const keyCount = await DBService.getUserApiKeyCount(userId);

      // Calculate limit:  base + bonus keys (max 3 bonus)
      let baseLimit = 1;
      if (user.is_premium || user.is_owner) baseLimit = 3;
      const bonusFromKeys = Math.min(keyCount, 3);
      const totalLimit = baseLimit + bonusFromKeys;

      if (!user.is_owner && sources.length >= totalLimit) {
        const msg = user.is_premium
          ? `Premium limitga yetdingiz (${totalLimit} ta). Qo'shimcha manba uchun API kalit qo'shing.`
          : `Asosiy limit ${baseLimit} ta. Ko'proq manba qo'shish uchun API kalit ulang (har kalit = +1 manba, max +3).`;
        return res.status(403).json({ error: msg, limit: totalLimit, current: sources.length });
      }

      await DBService.addSource(userId, name, url, lang || 'uz');
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/sources/:userId/:sourceId', checkAuth, async (req, res) => {
    try {
      await DBService.removeSource(parseInt(req.params.userId), parseInt(req.params.sourceId));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── SOURCE LIMIT INFO ─────────────────────────────────────────
  app.get('/api/sources/:userId/limit', checkAuth, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const user = await DBService.getUser(userId);
      if (!user) return res.status(404).json({ error: 'Not found' });

      const sources = await DBService.getUserSources(userId);
      const keyCount = await DBService.getUserApiKeyCount(userId);

      let baseLimit = 1;
      if (user.is_premium || user.is_owner) baseLimit = 3;
      const bonusFromKeys = Math.min(keyCount, 3);
      const totalLimit = user.is_owner ? 999 : baseLimit + bonusFromKeys;

      res.json({
        current: sources.length,
        total: totalLimit,
        base: baseLimit,
        bonus: bonusFromKeys,
        is_owner: !!user.is_owner,
        is_premium: !!(user.is_premium),
        api_key_count: keyCount
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── SETTINGS ─────────────────────────────────────────────────
  app.post('/api/settings/:userId', checkAuth, async (req, res) => {
    try {
      const { channel, interval, keywords } = req.body;
      const updates: any = {};
      if (channel !== undefined) updates.target_channel = channel || null;
      if (interval !== undefined) updates.interval_minutes = parseInt(interval) || 15;
      if (keywords !== undefined) updates.keywords = keywords || '';
      await DBService.updateUser(parseInt(req.params.userId), updates);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/settings/:userId/language', checkAuth, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { language } = req.body;
      const validLangs = ['uz', 'ru', 'en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar', 'hi', 'zh', 'ja', 'ko', 'fa'];
      if (!validLangs.includes(language)) return res.status(400).json({ error: "Noto'g'ri til kodi" });
      await DBService.updateUser(userId, { language });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/settings/:userId/schedule', checkAuth, async (req, res) => {
    try {
      const { schedule } = req.body;
      await DBService.setScheduleTimes(parseInt(req.params.userId), schedule || '');
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/settings/:userId/digest', checkAuth, async (req, res) => {
    try {
      const { enabled, time } = req.body;
      await DBService.setDailyDigest(parseInt(req.params.userId), !!enabled, time || '20:00');
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/settings/:userId/toggle', checkAuth, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const user = await DBService.getUser(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });
      await DBService.updateUser(userId, { is_active: user.is_active ? 0 : 1 });
      res.json({ success: true, is_active: !user.is_active });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── REFERRAL ─────────────────────────────────────────────────
  app.get('/api/referral/:userId', checkAuth, async (req, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const stats = await DBService.getReferralStats(userId);
      const code = await DBService.ensureReferralCode(userId);
      const botUsername = CONFIG.TELEGRAM_TOKEN
        ? await bot.getMe().then((me: any) => me.username).catch(() => 'YourBot')
        : 'YourBot';
      const link = `https://t.me/${botUsername}?start=ref_${code}`;
      res.json({ ...stats, code, link });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── PREMIUM ───────────────────────────────────────────────────
  app.get('/api/admin/prices', checkAuth, async (req, res) => {
    try {
      const prices = {
        monthly: await DBService.getPrice('monthly'),
        yearly: await DBService.getPrice('yearly'),
        stars: await DBService.getSetting('premium_stars_price') || '500',
        ton: await DBService.getSetting('premium_ton_price') || '2.5',
        uzs: await DBService.getSetting('premium_uzs_price') || '120,000'
      };
      res.json(prices);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/prices', checkAdmin, async (req, res) => {
    try {
      const { monthly, yearly, stars, ton, uzs } = req.body;
      if (monthly !== undefined) await DBService.setPrice('monthly', monthly);
      if (yearly !== undefined) await DBService.setPrice('yearly', yearly);
      if (stars !== undefined) await DBService.setSetting('premium_stars_price', stars.toString());
      if (ton !== undefined) await DBService.setSetting('premium_ton_price', ton.toString());
      if (uzs !== undefined) await DBService.setSetting('premium_uzs_price', uzs.toString());
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/premium/buy', checkAuth, async (req, res) => {
    try {
      const { userId, method } = req.body;
      const amount = method === 'yearly' ? await DBService.getPrice('yearly') : await DBService.getPrice('monthly');
      
      if (method === 'stars') {
        const starsPrice = parseInt(await DBService.getSetting('premium_stars_price') || '500');
        if (bot && typeof bot.createInvoiceLink === 'function') {
          const invoice = await bot.createInvoiceLink(
            'Premium Obuna',
            'Cheksiz manbalar va barcha premium imkoniyatlar',
            'premium_sub_' + userId,
            '',
            'XTR',
            [{ label: 'Premium', amount: starsPrice }]
          );
          res.json({ invoice_url: invoice });
        } else {
          res.status(503).json({ error: 'Invoice generation unavailable' });
        }
      } else if (method === 'payme') {
        const url = await PaymentService.generatePaymeLink(userId, amount);
        res.json({ url });
      } else if (method === 'click') {
        const url = await PaymentService.generateClickLink(userId, amount);
        res.json({ url });
      } else if (method === 'stripe') {
        const session = await PaymentService.createStripeSession(userId, amount);
        res.json({ url: session.url });
      } else if (method === 'ton') {
        const tonPrice = await DBService.getSetting('premium_ton_price') || '2.5';
        const tonWallet = await DBService.getSetting('premium_ton_wallet') || '';
        const admin = await DBService.getSetting('admin_username') || '@admin';
        res.json({ details: `💎 TON:\n${tonPrice} TON → ${tonWallet}\n\nTo'lovdan keyin adminga yozing: ${admin}` });
      } else if (method === 'uzs') {
        const uzsPrice = await DBService.getSetting('premium_uzs_price') || '120,000';
        const uzsDetails = await DBService.getSetting('premium_uzs_details') || '';
        const admin = await DBService.getSetting('admin_username') || '@admin';
        res.json({ details: `💳 UZS:\n${uzsPrice} UZS → ${uzsDetails}\n\nTo'lovdan keyin adminga yozing: ${admin}` });
      } else {
        res.status(400).json({ error: 'Invalid method' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── PAYMENT WEBHOOKS ─────────────────────────────────────────
  app.post('/api/payments/payme', async (req, res) => {
    const result = await PaymentService.handlePaymeWebhook(req.body);
    res.json(result);
  });

  // ── API KEYS ─────────────────────────────────────────────────
  app.get('/api/api-keys/:userId', checkAuth, async (req, res) => {
    try {
      const keys = await DBService.getUserApiKeys(parseInt(req.params.userId));
      // Don't expose full key, mask it
      const masked = (keys || []).map((k: any) => ({
        ...k,
        api_key: k.api_key.slice(0, 8) + '****' + k.api_key.slice(-4)
      }));
      res.json(masked);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/api-keys', checkAuth, async (req, res) => {
    try {
      const { userId, key, type } = req.body;
      if (!key || key.length < 10) {
        return res.status(400).json({ error: "API kaliti juda qisqa yoki bo'sh" });
      }
      const validTypes = ['groq', 'gemini', 'cerebras', 'openrouter', 'openai'];
      if (!validTypes.includes(type)) {
        return res.status(400).json({ error: `Noto'g'ri tur. Mumkin: ${validTypes.join(', ')}` });
      }
      const isDuplicate = await DBService.isKeyExists(key.trim());
      if (isDuplicate) {
        return res.status(400).json({ error: 'Bu API kalit allaqachon tizimda mavjud' });
      }
      const isValid = await validateApiKey(key, type);
      if (!isValid) {
        return res.status(400).json({ error: 'API kalit ishlamaydi yoki noto\'g\'ri kiritildi' });
      }
      const uid = parseInt(userId);
      const currentKeyCount = await DBService.getUserApiKeyCount(uid);
      await DBService.addApiKey(uid, key.trim(), type);
      await refreshKeyPool();
      // Source bonus is computed dynamically from getUserApiKeyCount() - no extra_sources update needed
      const newKeyCount = await DBService.getUserApiKeyCount(uid);
      res.json({
        success: true,
        message: currentKeyCount < 3
          ? `API kalit qo'shildi! Sizga +1 manba qo'shish huquqi berildi.`
          : 'API kalit tizimga qo\'shildi (maksimal bonus olindi).',
        api_key_count: newKeyCount
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  async function validateApiKey(key: string, type: string): Promise<boolean> {
    try {
      return await validateKey(type as any, key);
    } catch {
      return false;
    }
  }

  // ── BOT INFO ─────────────────────────────────────────────────
  app.get('/api/bot-info', checkAuth, async (req, res) => {
    try {
      if (!bot || typeof bot.getMe !== 'function') {
        return res.status(503).json({ error: 'Bot not available' });
      }
      const me = await bot.getMe();
      res.json({ username: me.username, first_name: me.first_name });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── AI ────────────────────────────────────────────────────────
  app.post('/api/ai/smm', checkAuth, async (req, res) => {
    try {
      const { prompt, withImage = false, userId } = req.body;
      if (!prompt || prompt.trim().length < 3) {
        return res.status(400).json({ error: 'Mavzu kiritilishi shart (min 3 belgi)' });
      }
      const systemPrompt = `Siz professional SMM menejeri va kopiraytersiz. Berilgan mavzu bo'yicha Telegram uchun jalb qiluvchi, emojilar bilan boyitilgan, o'zbek tilida post yozing. Post qisqa (maks 200 so'z), aniq va ta'sirli bo'lsin. Faqat tayyor postni yozing, boshqa hech narsa qo'shmang.`;
      const result = await getSmartAIResponse(systemPrompt, prompt);
      let imageUrl: string | null = null;
      if (withImage) {
        imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt + ', professional, high quality, 4k')}?width=1280&height=720&seed=${Date.now()}&nologo=true`;
      }
      res.json({ text: result, imageUrl });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/ai/post-to-channel', checkAuth, async (req, res) => {
    try {
      const { userId, text } = req.body;
      const user = await DBService.getUser(parseInt(userId));
      if (!user?.target_channel) return res.status(400).json({ error: 'Kanal sozlanmagan. Avval kanal ID ni kiriting.' });
      if (bot && typeof bot.sendMessage === 'function') {
        await bot.sendMessage(user.target_channel, text, { parse_mode: 'HTML' });
        res.json({ success: true });
      } else {
        res.status(503).json({ error: 'Bot xizmati mavjud emas' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/ai/generate-media', checkAuth, async (req, res) => {
    try {
      const { prompt } = req.body;
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&enhance=true&seed=${Date.now()}`;
      res.json({ url: imageUrl, type: 'image' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── SERVICES ─────────────────────────────────────────────────
  // Music search (returns YouTube results list, no download via web)
  app.get('/api/music/search', checkAuth, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.status(400).json({ error: 'Qidiruv so\'zi kiritilishi shart' });
      const results = await MusicService.getYouTubeVideoIds(q as string, 8);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/music/download/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const url = `https://youtube.com/watch?v=${id}`;
      // In a real implementation, we would stream from ytdl-core
      // For now, we'll return the URL or a redirect
      res.redirect(url);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Price search
  app.get('/api/price/search', checkAuth, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.status(400).json({ error: 'Qidiruv so\'zi kiritilishi shart' });
      const results = await PriceTrackerService.searchProducts(q as string);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Tracked prices
  app.get('/api/prices/:userId', checkAuth, async (req, res) => {
    try {
      const prices = await DBService.getTrackedPrices(parseInt(req.params.userId));
      res.json(prices);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // YouTube: redirect user to bot for download (can't do file transfer via web)
  app.post('/api/youtube/info', checkAuth, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || !url.includes('youtu')) {
        return res.status(400).json({ error: "To'g'ri YouTube havolasi kiriting" });
      }
      res.json({
        success: true,
        message: 'Botga havola yuboring: yuklash bot orqali amalga oshiriladi.',
        url
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── MONITORING ───────────────────────────────────────────────
  app.post('/api/monitor/add', checkAuth, async (req, res) => {
    try {
      const { userId, platform, channelId, name } = req.body;
      if (!userId || !platform || !channelId) {
        return res.status(400).json({ error: 'userId, platform va channelId kiritilishi shart' });
      }
      await DBService.addMonitoredChannel(parseInt(userId), platform, channelId, name || channelId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/monitor/:userId', checkAuth, async (req, res) => {
    try {
      const results = await DBService.getUserMonitoredChannels(parseInt(req.params.userId));
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/monitor/:userId/:id', checkAuth, async (req, res) => {
    try {
      await DBService.removeMonitoredChannel(parseInt(req.params.userId), parseInt(req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── ADMIN ─────────────────────────────────────────────────────
  app.post('/api/admin/users/:telegramId/premium', checkAdmin, async (req, res) => {
    try {
      const { telegramId } = req.params;
      const { days } = req.body;
      if (days > 0) {
        await DBService.setPremium(parseInt(telegramId), days);
      } else {
        await DBService.revokePremium(parseInt(telegramId));
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/users/:telegramId/approve', checkAdmin, async (req: any, res: any) => {
    try {
      await DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 1 });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/users/:telegramId/block', checkAdmin, async (req, res) => {
    try {
      await DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 0, is_active: 0 });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/broadcast', checkAdmin, async (req, res) => {
    try {
      const { message } = req.body;
      const users = await DBService.getAllUsers();
      let count = 0;
      for (const user of users) {
        try {
          if (bot && typeof bot.sendMessage === 'function') {
            await bot.sendMessage(user.telegram_id, `📢 <b>ADMIN XABARI:</b>\n\n${message}`, { parse_mode: 'HTML' });
            count++;
            await new Promise(r => setTimeout(r, 80));
          }
        } catch {}
      }
      res.json({ success: true, count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/system', checkAuth, async (req, res) => {
    try {
      const mem = process.memoryUsage();
      res.json({
        uptime: Math.floor(process.uptime()),
        ram: Math.round(mem.heapUsed / 1024 / 1024),
        platform: process.platform,
        nodeVersion: process.version
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/services/post-to-group', checkAuth, async (req, res) => {
    try {
      const { userId, service, message } = req.body;
      const requestingUser = await DBService.getUser(parseInt(userId));
      if (!requestingUser) return res.status(404).json({ error: 'User not found' });
      const ownerUsers = (await DBService.getAllUsers()).filter((u: any) => u.is_owner);
      if (ownerUsers.length > 0) {
        for (const owner of ownerUsers) {
          try {
            await notify(owner.telegram_id, `🔔 Xizmat so'rovi: ${service}\nUser: ${requestingUser.telegram_id}\n${message}`);
          } catch {}
        }
        res.json({ success: true });
      } else {
        res.status(503).json({ error: 'Admin topilmadi' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/ai/generate-media', checkAuth, async (req, res) => {
    try {
      const { prompt } = req.body;
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&nologo=true&enhance=true&seed=${Date.now()}`;
      res.json({ url: imageUrl, type: 'image' });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── SERVICES ─────────────────────────────────────────────────
  // Music search (returns YouTube results list, no download via web)
  app.get('/api/music/search', checkAuth, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.status(400).json({ error: 'Qidiruv so\'zi kiritilishi shart' });
      const results = await MusicService.getYouTubeVideoIds(q as string, 8);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/music/download/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const url = `https://youtube.com/watch?v=${id}`;
      // In a real implementation, we would stream from ytdl-core
      // For now, we'll return the URL or a redirect
      res.redirect(url);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Price search
  app.get('/api/price/search', checkAuth, async (req, res) => {
    try {
      const { q } = req.query;
      if (!q) return res.status(400).json({ error: 'Qidiruv so\'zi kiritilishi shart' });
      const results = await PriceTrackerService.searchProducts(q as string);
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Tracked prices
  app.get('/api/prices/:userId', checkAuth, async (req, res) => {
    try {
      const prices = await DBService.getTrackedPrices(parseInt(req.params.userId));
      res.json(prices);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // YouTube: redirect user to bot for download (can't do file transfer via web)
  app.post('/api/youtube/info', checkAuth, async (req, res) => {
    try {
      const { url } = req.body;
      if (!url || !url.includes('youtu')) {
        return res.status(400).json({ error: "To'g'ri YouTube havolasi kiriting" });
      }
      res.json({
        success: true,
        message: 'Botga havola yuboring: yuklash bot orqali amalga oshiriladi.',
        url
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── MONITORING ───────────────────────────────────────────────
  app.post('/api/monitor/add', checkAuth, async (req, res) => {
    try {
      const { userId, platform, channelId, name } = req.body;
      if (!userId || !platform || !channelId) {
        return res.status(400).json({ error: 'userId, platform va channelId kiritilishi shart' });
      }
      await DBService.addMonitoredChannel(parseInt(userId), platform, channelId, name || channelId);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/monitor/:userId', checkAuth, async (req, res) => {
    try {
      const results = await DBService.getUserMonitoredChannels(parseInt(req.params.userId));
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/monitor/:userId/:id', checkAuth, async (req, res) => {
    try {
      await DBService.removeMonitoredChannel(parseInt(req.params.userId), parseInt(req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── ADMIN ─────────────────────────────────────────────────────
  app.post('/api/admin/users/:telegramId/premium', checkAdmin, async (req, res) => {
    try {
      const { telegramId } = req.params;
      const { days } = req.body;
      if (days > 0) {
        await DBService.setPremium(parseInt(telegramId), days);
      } else {
        await DBService.revokePremium(parseInt(telegramId));
      }
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/users/:telegramId/approve', checkAdmin, async (req: any, res: any) => {
    try {
      await DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 1 });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/users/:telegramId/block', checkAdmin, async (req, res) => {
    try {
      await DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 0, is_active: 0 });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/admin/broadcast', checkAdmin, async (req, res) => {
    try {
      const { message } = req.body;
      const users = await DBService.getAllUsers();
      let count = 0;
      for (const user of users) {
        try {
          if (bot && typeof bot.sendMessage === 'function') {
            await bot.sendMessage(user.telegram_id, `📢 <b>ADMIN XABARI:</b>\n\n${message}`, { parse_mode: 'HTML' });
            count++;
            await new Promise(r => setTimeout(r, 80));
          }
        } catch {}
      }
      res.json({ success: true, count });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/admin/system', checkAuth, async (req, res) => {
    try {
      const mem = process.memoryUsage();
      res.json({
        uptime: Math.floor(process.uptime()),
        ram: Math.round(mem.heapUsed / 1024 / 1024),
        platform: process.platform,
        nodeVersion: process.version
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/services/post-to-group', checkAuth, async (req, res) => {
    try {
      const { userId, service, message } = req.body;
      const requestingUser = await DBService.getUser(parseInt(userId));
      if (!requestingUser) return res.status(404).json({ error: 'User not found' });
      const ownerUsers = (await DBService.getAllUsers()).filter((u: any) => u.is_owner);
      if (ownerUsers.length > 0) {
        for (const owner of ownerUsers) {
          try {
            await notify(owner.telegram_id, `🔔 Xizmat so'rovi: ${service}\nUser: ${requestingUser.telegram_id}\n${message}`);
          } catch {}
        }
        res.json({ success: true });
      } else {
        res.status(503).json({ error: 'Admin topilmadi' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ── SPA fallback ─────────────────────────────────────────────
  app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  // ── DASHBOARD INFO (ELITE API) ───────────────────────────────
  app.get('/api/dashboard-info', checkAuth, async (req, res) => {
    try {
      const userId = parseInt(req.query.userId as string);
      const user = await DBService.getUser(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      const stats = await DBService.getStats(userId);
      const scheduled = await DBService.getUserScheduledPosts(userId);
      const referrals = await DBService.getReferralStats(userId);
      
      let tickets = [];
      if (user.role === 'owner' || user.role === 'admin') {
        tickets = await DBService.getTickets();
      } else {
        tickets = await DBService.getUserTickets(userId);
      }

      res.json({
        user: {
          id: user.telegram_id,
          username: user.username,
          language: user.language,
          is_premium: user.is_premium,
          role: user.role || 'user',
          premium_until: user.premium_until,
          stats
        },
        scheduled,
        referrals,
        tickets
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  app.listen(port, () => {
    logger.info(`🖥 Dashboard server started on port ${port}`);
  });

  return app;
}
