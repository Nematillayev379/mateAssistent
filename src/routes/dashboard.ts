import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { CONFIG } from '../config/config';
import { DBService } from '../services/database';
import { bot } from '../services/bot_instance';
import { logger } from '../utils/logger';
import { MusicService } from '../services/music';
import { PaymentService } from '../services/payment';
import { generateSmmImage, generateSmmPost, getActiveKeyStats, getSmartAIResponse, refreshKeyPool, validateKey } from '../services/ai';
import { buildKeyPoolFromEnv, countKeysByProvider, getEnvKeySourceReport, isOwnerId } from '../config/config';
import { ScraperService } from '../services/scraper';
import { FinanceService } from '../services/finance';
import { TelegramMonitorService, normalizeTelegramChannelId } from '../services/telegram_monitor';
import { PriceTrackerService } from '../services/pricetracker';
import { TrendsService } from '../services/trends';
import { generateTTS, generateAudioSummary } from '../services/ai';
import { safeSendToChannels } from '../services/telegram';
import { checkAuth, checkAdmin, extractUserId, timingSafeCompare, verifyTelegramWebAppData } from '../middleware/auth';

export function registerRoutes(app: express.Application) {
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    skip: (req) => req.path === '/api/bot/webhook'
  });
  app.use('/api/', apiLimiter);

  const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: async (req: any) => {
      const userId = req.headers['x-user-id'] || req.query.userId || req.query.user || req.body?.userId;
      if (userId) return (await DBService.isPremiumActive(parseInt(userId as string))) ? 30 : 10;
      return 10;
    },
    message: { error: 'AI request limit exceeded.' }
  });

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

  app.post('/api/auth/telegram', async (req, res) => {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ error: 'Missing initData' });
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser || !tgUser.id) return res.status(401).json({ error: 'Invalid Telegram data' });
    let user = await DBService.getUser(tgUser.id);
    if (!user) user = await DBService.upsertUser(tgUser.id, isOwnerId(tgUser.id) ? 1 : 0, tgUser.username, tgUser.first_name);
    if (!user) return res.status(500).json({ error: 'User creation failed' });
    if (isOwnerId(tgUser.id) && user.role !== 'owner') {
      await DBService.updateUserRole(tgUser.id, 'owner');
      user.role = 'owner';
    }
    const token = require('../services/bot_instance').generateDashboardToken(tgUser.id);
    res.json({ token, userId: tgUser.id, role: user.role || 'user' });
  });

  app.post('/api/auth/master', async (req, res) => {
    const { token } = req.body;
    if (token && CONFIG.DASHBOARD_SECRET && timingSafeCompare(token, CONFIG.DASHBOARD_SECRET)) {
      if (CONFIG.OWNER_ID == null) return res.status(500).json({ error: 'Owner ID not configured' });
      const ownerId = CONFIG.OWNER_ID as number;
      let user = await DBService.getUser(ownerId);
      if (!user) user = await DBService.upsertUser(ownerId, 1, 'Owner', 'Owner');
      if (user && user.role !== 'owner') await DBService.updateUserRole(ownerId, 'owner');
      return res.json({ token, userId: ownerId, role: user?.role || 'owner' });
    }
    await new Promise(resolve => setTimeout(resolve, 1500));
    res.status(401).json({ error: 'Invalid master token' });
  });

  app.get('/api/dashboard-info', checkAuth, async (req: any, res: any) => {
    const userId = parseInt(req.authenticatedUserId);
    const user = await DBService.getUser(userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const effectiveRole = user.role || (user.is_owner ? 'owner' : 'user');
    res.json({
      user: { id: user.telegram_id, telegram_id: user.telegram_id, username: user.username, first_name: user.first_name, role: effectiveRole, is_owner: !!user.is_owner, is_premium: !!user.is_premium, is_approved: !!user.is_approved, is_active: user.is_active !== 0, target_channel: user.target_channel || null, language: user.language || 'uz', premium_until: user.premium_until || null },
      stats: await DBService.getStats(userId),
      scheduled: await DBService.getUserScheduledPosts(userId),
      referrals: await DBService.getReferralStats(userId),
      tickets: (user.role === 'owner' || user.role === 'admin') ? await DBService.getTickets() : await DBService.getUserTickets(userId)
    });
  });

  app.get('/api/user/:userId', checkAuth, async (req: any, res: any) => {
    const u = await DBService.getUser(parseInt(req.authenticatedUserId));
    res.json(u ? { ...u, api_key_count: await DBService.getUserApiKeyCount(u.telegram_id) } : { error: 'Not found' });
  });

  app.get('/api/sources/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserSources(parseInt(req.authenticatedUserId))));

  app.post('/api/sources/:userId', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { name, url, lang } = req.body;
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return res.status(400).json({ error: 'Invalid URL' });
    if (!(await ScraperService.isPublicExternalUrl(url))) return res.status(400).json({ error: 'Private URLs not allowed' });
    const discovered = await ScraperService.discoverRSS(url);
    if (!discovered) return res.status(400).json({ error: 'URL yaroqli RSS/Atom formatida emas' });
    if (!(await DBService.checkUserLimit(uid, 'sources'))) return res.status(403).json({ error: 'Limit reached' });
    await DBService.addSource(uid, name, discovered, lang || 'uz');
    res.json({ success: true });
  });

  app.delete('/api/sources/:userId/:id', checkAuth, async (req: any, res: any) => {
    const sourceId = parseInt(req.params.id);
    if (!sourceId || sourceId <= 0 || isNaN(sourceId)) return res.status(400).json({ error: 'Invalid ID' });
    await DBService.removeSource(parseInt(req.authenticatedUserId), sourceId);
    res.json({ success: true });
  });

  app.post('/api/settings/:userId/toggle', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const u = await DBService.getUser(uid);
    if (!u) return res.status(404).json({ error: 'Not found' });
    const next = u.is_active ? 0 : 1;
    await DBService.updateUser(uid, { is_active: next });
    res.json({ success: true, is_active: next });
  });

  app.get('/api/settings/:userId', checkAuth, async (req: any, res: any) => {
    const u = await DBService.getUser(parseInt(req.authenticatedUserId));
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json({ language: u.language, target_channel: u.target_channel, is_active: u.is_active, is_premium: u.is_premium });
  });

  app.post('/api/settings/:userId', checkAuth, async (req: any, res: any) => {
    const { language, target_channel } = req.body;
    const userId = parseInt(req.authenticatedUserId);
    if (typeof target_channel === 'string' && target_channel.trim()) {
      const normalized = DBService.normalizeTargetChannel(target_channel);
      if (!normalized.startsWith('@') && !normalized.startsWith('-100')) return res.status(400).json({ error: 'Invalid target channel format' });
      try {
        const chat = await bot.getChat(normalized);
        const me = await bot.getMe();
        const member = await bot.getChatMember(chat.id, me.id);
        if (member.status !== 'administrator' && member.status !== 'creator') return res.status(400).json({ error: 'Bot target kanalda admin emas' });
      } catch (e: any) { return res.status(400).json({ error: 'Channel verification failed' }); }
    }
    const ok = await DBService.updateUser(userId, { language, target_channel });
    if (!ok) return res.status(500).json({ error: 'Settings update failed' });
    res.json({ success: true });
  });

  app.get('/api/settings/:userId/extended', checkAuth, async (req: any, res: any) => {
    const u = await DBService.getUser(parseInt(req.authenticatedUserId));
    if (!u) return res.status(404).json({ error: 'Not found' });
    const keywords = await DBService.getKeywords(parseInt(req.authenticatedUserId));
    res.json({ language: u.language, target_channel: u.target_channel, is_active: u.is_active, is_premium: u.is_premium, keywords: keywords.join(', '), daily_digest: u.daily_digest, digest_time: u.digest_time, schedule_times: u.schedule_times, interval_minutes: Math.max(Number(u.interval_minutes) || 15, 1) });
  });

  app.post('/api/settings/:userId/extended', checkAuth, async (req: any, res: any) => {
    const { language, target_channel, keywords, daily_digest, digest_time, schedule_times, interval_minutes } = req.body;
    const userId = parseInt(req.authenticatedUserId);
    const safeInterval = Math.max(Math.min(Number(interval_minutes) || 15, 1440), 1);
    if (typeof target_channel === 'string' && target_channel.trim()) {
      const normalized = DBService.normalizeTargetChannel(target_channel);
      if (!normalized.startsWith('@') && !normalized.startsWith('-100')) return res.status(400).json({ error: 'Invalid target channel format' });
      try {
        const chat = await bot.getChat(normalized);
        const me = await bot.getMe();
        const member = await bot.getChatMember(chat.id, me.id);
        if (member.status !== 'administrator' && member.status !== 'creator') return res.status(400).json({ error: 'Bot target kanalda admin emas' });
      } catch { return res.status(400).json({ error: 'Channel verification failed' }); }
    }
    const updates: Record<string, any> = {};
    if (language !== undefined) updates.language = language;
    if (target_channel !== undefined) updates.target_channel = target_channel;
    if (daily_digest !== undefined) updates.daily_digest = daily_digest;
    if (digest_time !== undefined) updates.digest_time = digest_time;
    if (schedule_times !== undefined) updates.schedule_times = schedule_times;
    if (interval_minutes !== undefined) updates.interval_minutes = safeInterval;
    const ok = Object.keys(updates).length ? await DBService.updateUser(userId, updates) : true;
    if (!ok) return res.status(500).json({ error: 'Settings update failed' });
    if (keywords !== undefined) await DBService.setKeywords(parseInt(req.authenticatedUserId), keywords);
    res.json({ success: true });
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
    let redisStatus = false;
    try { const redis = await (await import('../services/redis')).getRedisConnection(); if (redis) { await redis.ping(); redisStatus = true; } } catch {}
    const envPool = buildKeyPoolFromEnv();
    const active = getActiveKeyStats();
    res.json({ uptime: process.uptime(), memory: process.memoryUsage(), redis: redisStatus, nodeVersion: process.version, aiKeys: { envLoaded: envPool.length, activeLoaded: active.total, envByProvider: countKeysByProvider(envPool), activeByProvider: active.byProvider, envVarCounts: getEnvKeySourceReport() } });
  });

  app.post('/api/admin/ai-keys/refresh', checkAdmin, async (_req, res) => { await refreshKeyPool(); res.json({ success: true, ...getActiveKeyStats() }); });

  app.post('/api/admin/broadcast', checkAdmin, aiLimiter, async (req: any, res: any) => {
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

  app.get('/api/music/search', checkAuth, async (req, res) => res.json(await MusicService.getYouTubeVideoIds(req.query.q as string, 8)));

  app.get('/api/music/download/:id', checkAuth, async (req: any, res: any) => {
    const videoId = req.params.id;
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return res.status(400).json({ error: 'Invalid video ID' });
    const userId = parseInt(req.authenticatedUserId);
    const webOnly = req.query.web === '1';
    const sendToChannel = req.query.send === '1';
    try {
      const { downloadYouTube } = await import('../services/youtube');
      const filePath = await downloadYouTube(`https://youtube.com/watch?v=${videoId}`, 'audio');
      const ext = path.extname(filePath) || '.mp3';
      const filename = `music_${videoId}${ext}`;

      if (sendToChannel) {
        const userData = await (await import('../services/database')).DBService.getUser(userId);
        const target = userData?.target_channel;
        if (!target) return res.status(400).json({ success: false, error: 'Target channel not configured' });
        await bot.sendAudio(target, filePath);
        logger.info(`Music sent to channel ${target} for user ${userId}`);
        return res.json({ success: true, message: 'Musiqa kanalga yuborildi!' });
      }

      await serveFileDownload(res, filePath, filename, { userId, notifyBot: webOnly ? undefined : 'audio' });
    } catch (e: any) {
      logger.warn(`Music download failed for ${videoId}: ${e.message}`);
      res.status(502).json({ error: 'Download failed' });
    }
  });

  app.post('/api/media/download', checkAuth, async (req: any, res: any) => {
    const { url, type } = req.body;
    const userId = parseInt(req.authenticatedUserId);
    const webOnly = req.query.web === '1' || req.body?.delivery === 'web';
    if (!['video', 'audio'].includes(type)) return res.status(400).json({ error: 'Invalid media type' });
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Invalid URL' });
    try {
      const { downloadYouTube } = await import('../services/youtube');
      const filePath = await downloadYouTube(url, type);
      const ext = path.extname(filePath) || (type === 'video' ? '.mp4' : '.mp3');
      const filename = `media_${Date.now()}${ext}`;
      await serveFileDownload(res, filePath, filename, { userId, notifyBot: webOnly ? undefined : (type === 'video' ? 'video' : 'audio') });
    } catch (e: any) {
      logger.warn(`Media download failed: ${e.message}`);
      res.status(502).json({ error: 'Download failed' });
    }
  });

  app.get('/api/finance/prices', checkAuth, async (req, res) => {
    try { const crypto = await FinanceService.getCryptoPrices(); const usd = await FinanceService.getUSDRate(); res.json({ btc: crypto.BTC || 'N/A', usd: usd || 'N/A' }); }
    catch { res.json({ btc: 'N/A', usd: 'N/A' }); }
  });

  app.post('/api/ai/smm', checkAuth, aiLimiter, async (req: any, res: any) => {
    const { prompt, withImage, language } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') return res.status(400).json({ error: 'Prompt bo\'sh bo\'lishi mumkin emas.' });
    try {
      const user = await DBService.getUser(parseInt(req.authenticatedUserId));
      const postLanguage = typeof language === 'string' && language.trim() ? language.trim().slice(0, 8) : user?.language || 'uz';
      const [text, img] = await Promise.all([generateSmmPost(prompt.trim(), postLanguage), withImage === true || withImage === 'true' ? generateSmmImage(prompt.trim()) : Promise.resolve(null)]);
      res.json({ text, imageUrl: img?.imageUrl || null, imageBase64: img?.imageBase64 || null });
    } catch (e: any) { logger.error(`SMM generate error: ${e.message}`); res.status(500).json({ error: 'AI xatolik' }); }
  });

  app.post('/api/ai/post-to-channel', checkAuth, async (req: any, res: any) => {
    const { text, imageUrl, imageBase64 } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Invalid text' });
    try {
      const user = await DBService.getUser(parseInt(req.authenticatedUserId));
      if (!user?.target_channel) return res.status(400).json({ error: 'No channel configured' });
      const caption = `AI Voice News\n\n`;
      const remainder = text.length > 1024 ? text.slice(1024) : '';
      if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.startsWith('data:image')) {
        await bot.sendPhoto(user.target_channel, Buffer.from(imageBase64.split(',')[1], 'base64'), { caption });
      } else if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
        await bot.sendPhoto(user.target_channel, imageUrl, { caption });
      } else {
        await bot.sendMessage(user.target_channel, text);
      }
      if (remainder) await bot.sendMessage(user.target_channel, remainder);
      res.json({ success: true });
    } catch (e: any) { logger.error(`SMM post-to-channel error: ${e.message}`); res.status(500).json({ error: 'Telegram send failed' }); }
  });

  app.get('/api/tracker/search', checkAuth, async (req: any, res: any) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string' || q.trim() === '') return res.status(400).json({ error: 'Qidiruv so\'rovi kiritilmagan' });
    try {
      res.json((await PriceTrackerService.searchProducts(q.trim())).sort((a: any, b: any) => a.price - b.price));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/tracker/cheapest', checkAuth, async (req: any, res: any) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string' || q.trim() === '') return res.status(400).json({ error: 'Qidiruv so\'rovi kiritilmagan' });
    try {
      let results = await PriceTrackerService.searchProducts(q.trim());
      if (!results.length) {
        try {
          const scraped = await ScraperService.searchProducts(q.trim());
          results = (scraped || []).map((item: any) => ({ title: item.name || item.title || 'Mahsulot', price: Number(item.price) || 0, url: item.url, source: item.store || item.source || 'Marketplace' })).filter((item: any) => item.url && Number.isFinite(item.price) && item.price > 0).sort((a: any, b: any) => a.price - b.price);
        } catch {}
      }
      const cheapest = results[0] || null;
      const bySource = Array.from(results.reduce((acc: Map<string, any>, item: any) => { const current = acc.get(item.source); if (!current || item.price < current.price) acc.set(item.source, item); return acc; }, new Map())).map(([, v]) => v).sort((a, b) => a.price - b.price);
      res.json({ cheapest, bySource });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/prices/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getTrackedPrices(parseInt(req.authenticatedUserId))));

  app.post('/api/prices/:userId', checkAuth, async (req: any, res: any) => {
    const { url, name, price } = req.body;
    const parsedPrice = Number(price);
    if (!url || !name || Number.isNaN(parsedPrice) || parsedPrice < 0) return res.status(400).json({ error: 'Invalid price tracker payload' });
    try {
      let finalName = name, finalPrice = parsedPrice;
      if (finalName === 'Tovar' || finalPrice === 0) {
        const resolved = await PriceTrackerService.fetchPrice(url);
        if (resolved) { finalName = resolved.title; finalPrice = resolved.price; }
      }
      await DBService.addTrackedPrice(parseInt(req.authenticatedUserId), url, finalName, finalPrice);
      res.json({ success: true });
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/api/prices/:userId/:id', checkAuth, async (req: any, res: any) => { await DBService.removePrice(parseInt(req.authenticatedUserId), parseInt(req.params.id)); res.json({ success: true }); });

  app.get('/api/channels/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserMonitoredChannels(parseInt(req.authenticatedUserId))));

  app.post('/api/channels/:userId', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { platform, channelId, name, forward_mode, use_ai } = req.body;
    if (!['youtube', 'instagram', 'telegram'].includes(platform) || !channelId) return res.status(400).json({ error: 'Invalid channel payload' });
    let resolvedId = channelId, resolvedName = name || channelId;
    if (platform === 'telegram') {
      const verify = await TelegramMonitorService.verifyBotInSourceChannel(channelId);
      if (!verify.ok) return res.status(400).json({ error: verify.error || 'Bot manba kanalda admin emas' });
      resolvedId = verify.chatId || normalizeTelegramChannelId(channelId);
      resolvedName = verify.title || resolvedName;
    }
    if (!(await DBService.checkUserLimit(uid, 'channels'))) return res.status(403).json({ error: 'Channel limit reached' });
    await DBService.addMonitoredChannel(uid, platform, resolvedId, resolvedName, { forward_mode: forward_mode || 'copy', use_ai: use_ai ? 1 : 0 });
    res.json({ success: true, channelId: resolvedId, name: resolvedName });
  });

  app.patch('/api/channels/:userId/:id', checkAuth, async (req: any, res: any) => {
    const updates: Record<string, any> = {};
    if (req.body.forward_mode) updates.forward_mode = req.body.forward_mode;
    if (req.body.use_ai !== undefined) updates.use_ai = req.body.use_ai ? 1 : 0;
    if (req.body.is_active !== undefined) updates.is_active = req.body.is_active ? 1 : 0;
    await DBService.updateMonitoredChannelSettings(parseInt(req.params.id), parseInt(req.authenticatedUserId), updates);
    res.json({ success: true });
  });

  app.delete('/api/channels/:userId/:id', checkAuth, async (req: any, res: any) => { await DBService.removeMonitoredChannel(parseInt(req.authenticatedUserId), parseInt(req.params.id)); res.json({ success: true }); });

  app.get('/api/output-channels/:userId', checkAuth, async (req: any, res: any) => {
    const u = await DBService.getUser(parseInt(req.authenticatedUserId));
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json({ primary: u.target_channel, extra: u.extra_channels || '', all: DBService.getUserOutputChannels(u) });
  });

  app.post('/api/output-channels/:userId', checkAuth, async (req: any, res: any) => {
    if (!Array.isArray(req.body.channels)) return res.status(400).json({ error: 'channels array required' });
    await DBService.setExtraChannels(parseInt(req.authenticatedUserId), req.body.channels);
    res.json({ success: true });
  });

  app.get('/api/trends/uz', checkAuth, async (req: any, res: any) => {
    try { const data = await TrendsService.scanUZTrends(req.query.refresh === '1' || req.query.refresh === 'true'); res.json(data); }
    catch (e: any) {
      const cached = await DBService.getLatestTrendsSnapshot();
      if (cached) return res.json({ topics: cached.topics, summary: cached.summary, at: cached.created_at });
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/ai/voice-news', checkAuth, aiLimiter, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { text, title, sendToChannel } = req.body;
    const user = await DBService.getUser(uid);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    const cleanText = typeof text === 'string' ? text.trim() : '';
    if (!cleanTitle && !cleanText) return res.status(400).json({ error: 'Sarlavha yoki matn kiriting' });
    const lang = typeof user.language === 'string' && user.language.trim() ? user.language.trim() : 'uz';
    const script = cleanText || await generateAudioSummary(cleanTitle || 'Yangilik', cleanText || cleanTitle || '', lang);
    const audio = await generateTTS(script, lang);
    if (!audio) return res.status(500).json({ error: 'Ovoz generatsiyasi muvaffaqiyatsiz' });
    const caption = `AI Voice News: <b>${cleanTitle || 'AI Ovoz Yangilik'}</b>\n\n${script.slice(0, 500)}`;
    const targets = sendToChannel ? DBService.getUserOutputChannels(user) : [uid];
    let sentCount = 0;
    for (const ch of targets) {
      try {
        await bot.sendAudio(sendToChannel ? ch : uid, audio as any, { caption, parse_mode: 'HTML' }, { filename: 'voice-news-file.mp3', contentType: 'audio/mpeg' } as any);
        sentCount++;
      } catch (e: any) { logger.warn(`Voice send failed ${ch}: ${e.message}`); }
    }
    if (sentCount === 0) return res.status(502).json({ error: 'Ovoz yuborilmadi' });
    res.json({ success: true, sent: sentCount, script: script.slice(0, 800) });
  });

  app.post('/api/posts/publish', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { text, imageUrl, channels } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Text required' });
    const user = await DBService.getUser(uid);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const targets = Array.isArray(channels) && channels.length ? channels : DBService.getUserOutputChannels(user);
    if (!targets.length) return res.status(400).json({ error: 'No output channels configured' });
    await safeSendToChannels(user, targets, async (target) => {
      if (imageUrl) await bot.sendPhoto(target, imageUrl, { caption: text, parse_mode: 'HTML' });
      else await bot.sendMessage(target, text, { parse_mode: 'HTML' });
    });
    await DBService.incrementStat(uid, 'total_posts');
    res.json({ success: true, sentTo: targets.length });
  });

  app.post('/api/posts/draft', checkAuth, async (req: any, res: any) => {
    const { title, body, image_url, channels } = req.body;
    if (!body) return res.status(400).json({ error: 'Body required' });
    const draft = await DBService.savePostDraft(parseInt(req.authenticatedUserId), { title, body, image_url, channels });
    res.json({ success: true, draft });
  });

  app.get('/api/posts/drafts/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserPostDrafts(parseInt(req.authenticatedUserId))));

  app.get('/api/tickets/all', checkAdmin, async (req, res) => res.json(await DBService.getTickets()));
  app.get('/api/tickets/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserTickets(parseInt(req.authenticatedUserId))));
  app.post('/api/tickets/:userId', checkAuth, async (req: any, res: any) => {
    const { subject, message } = req.body;
    res.json(await DBService.createTicket(parseInt(req.authenticatedUserId), subject, message));
  });

  app.get('/api/referral/:userId', checkAuth, async (req: any, res: any) => {
    const code = await DBService.ensureReferralCode(parseInt(req.authenticatedUserId));
    const stats = await DBService.getReferralStats(parseInt(req.authenticatedUserId));
    const botMe = await bot.getMe();
    res.json({ code, stats, refLink: `https://t.me/${botMe.username}?start=ref_${code}` });
  });

  app.get('/api/scheduled/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserScheduledPosts(parseInt(req.authenticatedUserId))));

  app.post('/api/scheduled/:userId', checkAuth, async (req: any, res: any) => {
    const { type, content, scheduledAt } = req.body;
    if (!['video', 'audio', 'text'].includes(type) || !content || !scheduledAt || isNaN(Date.parse(scheduledAt))) return res.status(400).json({ error: 'Invalid scheduled post payload' });
    try { await DBService.addScheduledPost(parseInt(req.authenticatedUserId), type, content, scheduledAt); res.json({ success: true }); }
    catch (e: any) { res.status(400).json({ error: 'Invalid scheduled post' }); }
  });

  app.delete('/api/scheduled/:userId/:id', checkAuth, async (req: any, res: any) => { await DBService.cancelScheduledPost(parseInt(req.authenticatedUserId), parseInt(req.params.id)); res.json({ success: true }); });

  app.get('/api/keys/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserApiKeys(parseInt(req.authenticatedUserId))));

  app.post('/api/keys', checkAdmin, async (req: any, res: any) => {
    const userIdForKey = Number(req.body?.userId || req.authenticatedUserId);
    const { key, type } = req.body;
    if (!userIdForKey || !key || !type || typeof key !== 'string' || typeof type !== 'string') return res.status(400).json({ error: 'Invalid api key payload' });
    if (!(CONFIG.API_KEY_SOURCES as readonly string[]).includes(type)) return res.status(400).json({ error: 'Unsupported API key type' });
    if (!(await validateKey(type as any, key))) return res.status(400).json({ error: 'API key validation failed' });
    const { ApiKeyService } = await import('../services/apiKeys');
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
    const { ApiKeyService } = await import('../services/apiKeys');
    await ApiKeyService.removeKey(id);
    res.json({ success: true });
  });

  app.get('/api/premium-info', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const priceMonthly = await DBService.getPrice('monthly');
    const priceYearly = await DBService.getPrice('yearly');
    const isActive = await DBService.isPremiumActive(uid);
    let expiresAt = null;
    if (isActive) { const user = await DBService.getUser(uid); expiresAt = user?.premium_until; }
    const starsPrice = parseInt(await DBService.getSetting('premium_stars_price') || '500');
    res.json({ monthlyPrice: priceMonthly, yearlyPrice: priceYearly, starsPrice, starsYearlyPrice: starsPrice * 10, isActive, expiresAt, benefits: ['10 ta RSS manba', 'Cheksiz kanal monitoring', 'Cheksiz schedule post', 'AI prioritet (30/min)', 'Kunlik digest', 'Premium badge va oltin tema'] });
  });

  app.post('/api/premium/buy', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { method, plan } = req.body;
    const isYearly = plan === 'yearly';
    if (method === 'stars') {
      const starsPrice = parseInt(await DBService.getSetting('premium_stars_price') || '500');
      const invoice = await bot.createInvoiceLink(isYearly ? 'mateAssistent Premium (1 Year)' : 'mateAssistent Premium (1 Month)', 'Premium access', `premium_sub_${uid}${isYearly ? '_yearly' : ''}`, '', 'XTR', [{ label: 'Premium', amount: isYearly ? starsPrice * 10 : starsPrice }]);
      return res.json({ success: true, url: invoice, method: 'stars' });
    }
    if (method === 'payme') {
      const amount = isYearly ? await DBService.getPrice('yearly') : await DBService.getPrice('monthly');
      const link = await PaymentService.generatePaymeLink(uid, amount, isYearly ? 'yearly' : 'monthly');
      if (!link) return res.status(503).json({ error: 'Payme sozlanmagan' });
      return res.json({ success: true, url: link, method: 'payme' });
    }
    if (method === 'click') {
      const amount = isYearly ? await DBService.getPrice('yearly') : await DBService.getPrice('monthly');
      const link = await PaymentService.generateClickLink(uid, amount, isYearly ? 'yearly' : 'monthly');
      if (!link) return res.status(503).json({ error: 'Click sozlanmagan' });
      return res.json({ success: true, url: link, method: 'click' });
    }
    res.status(400).json({ error: 'Unsupported method' });
  });

  app.get('/api/debug/ytdlp', checkAdmin, async (req: any, res: any) => {
    try {
      const { resolveYtDlpPath } = await import('../utils/ytdlp');
      const ytdlpPath = await resolveYtDlpPath();
      res.json({
        ytdlpPath,
        fsExists: ytdlpPath ? fs.existsSync(ytdlpPath) : false,
        size: ytdlpPath && fs.existsSync(ytdlpPath) ? fs.statSync(ytdlpPath).size : 0,
        version: ytdlpPath ? (await promisify(exec)((ytdlpPath.includes(' ') || ytdlpPath.includes('\\') ? `"${ytdlpPath}"` : ytdlpPath) + ' --version', { timeout: 5000 }).then(r => r.stdout.trim()).catch(() => 'error')) : 'not found',
        cwd: process.cwd(),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/payments/payme', async (req, res) => {
    try {
      if (!process.env.PAYME_KEY) { logger.warn('Payme webhook: PAYME_KEY not configured'); return res.status(200).json({ error: { code: -32504, message: 'Payment not configured' } }); }
      res.json(await PaymentService.handlePaymeWebhook(req.body, req.headers));
    } catch (e: any) { logger.error(`Payme webhook failed: ${e.message}`); res.status(500).json({ error: e.message }); }
  });

  app.post('/api/payments/click', async (req, res) => {
    try {
      res.status(200).json(await PaymentService.handleClickWebhook(req.body || {}));
    } catch (e: any) {
      logger.error(`Click webhook failed: ${e.message}`);
      res.status(200).json({ error: -9, error_note: 'Internal server error', click_trans_id: req.body?.click_trans_id || 0, merchant_trans_id: req.body?.merchant_trans_id || '' });
    }
  });

  app.use('/dashboard', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'), (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'Dashboard not found' }); });
  });

  // --- RULES API (No-Code Automation) ---
  app.get('/api/rules/:userId', checkAuth, async (req: any, res: any) => res.json(await DBService.getUserRules(parseInt(req.authenticatedUserId))));

  app.post('/api/rules/:userId', checkAuth, async (req: any, res: any) => {
    const { trigger, condition, action, actionValue } = req.body;
    if (!['keyword', 'source', 'time', 'category'].includes(trigger) || !condition || !action) {
      return res.status(400).json({ error: 'Invalid rule payload' });
    }
    const ok = await DBService.addRule(parseInt(req.authenticatedUserId), trigger, condition, action, actionValue || '');
    res.json({ success: ok });
  });

  app.patch('/api/rules/:userId/:id', checkAuth, async (req: any, res: any) => {
    const ok = await DBService.toggleRule(parseInt(req.params.id), req.body.isActive !== false);
    res.json({ success: ok });
  });

  app.delete('/api/rules/:userId/:id', checkAuth, async (req: any, res: any) => {
    await DBService.deleteRule(parseInt(req.params.id));
    res.json({ success: true });
  });

  app.get('/api/rules/:userId/suggest', checkAuth, async (req: any, res: any) => {
    const { RuleEngine } = await import('../services/rule_engine');
    const suggestions = await RuleEngine.suggestRules(parseInt(req.authenticatedUserId));
    res.json(suggestions);
  });

  // --- WORKSPACES API (Multi-Channel) ---
  app.get('/api/workspaces/:userId', checkAuth, async (req: any, res: any) => {
    const workspaces = await DBService.getUserWorkspaces(parseInt(req.authenticatedUserId));
    const result = [];
    for (const ws of workspaces) {
      const channels = await DBService.getWorkspaceChannels(ws.id);
      result.push({ ...ws, channels });
    }
    res.json(result);
  });

  app.post('/api/workspaces/:userId', checkAuth, async (req: any, res: any) => {
    const { WorkspaceService } = await import('../services/workspace');
    const result = await WorkspaceService.createWorkspace(parseInt(req.authenticatedUserId), req.body.name || 'My Workspace');
    res.status(result.error ? 400 : 200).json(result);
  });

  app.post('/api/workspaces/:userId/:id/channel', checkAuth, async (req: any, res: any) => {
    const { WorkspaceService } = await import('../services/workspace');
    const result = await WorkspaceService.addChannelToWorkspace(parseInt(req.params.id), req.body.channelId, req.body.name || '');
    res.status(result.error ? 400 : 200).json(result);
  });

  app.delete('/api/workspaces/:userId/:wid/channel/:chId', checkAuth, async (req: any, res: any) => {
    await DBService.removeWorkspaceChannel(req.params.chId, parseInt(req.params.wid));
    res.json({ success: true });
  });

  app.post('/api/workspaces/:userId/:id/rebalance', checkAuth, async (req: any, res: any) => {
    const { WorkspaceService } = await import('../services/workspace');
    await WorkspaceService.rebalanceContent(parseInt(req.params.id));
    res.json({ success: true });
  });

  // --- CLUSTERING API ---
  app.get('/api/clusters/today', checkAuth, async (req: any, res: any) => {
    const { ClusteringService } = await import('../services/clustering');
    const data = await ClusteringService.getClusters(req.query.refresh === '1');
    res.json(data);
  });

  // --- VISUAL BUILDER API ---
  app.post('/api/visual/post', checkAuth, async (req: any, res: any) => {
    const { VisualBuilder } = await import('../services/visual_builder');
    const { title, content, sourceUrl, category } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const image = await VisualBuilder.createPostImage(title, category);
    const caption = VisualBuilder.formatCaption(title, content || '', sourceUrl);
    res.json({ image: image.imageUrl, imageBase64: image.imageBase64, caption });
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'), (err) => { if (err && !res.headersSent) res.status(404).json({ error: 'Page not found' }); });
  });
}

const serveFileDownload = async (res: any, filePath: string, filename: string, opts?: { userId?: number; notifyBot?: string }) => {
  if (opts?.notifyBot && opts.userId) {
    try {
      if (opts.notifyBot === 'video') await bot.sendVideo(opts.userId, filePath, { caption: '📥 WebApp orqali yuklandi' });
      else await bot.sendAudio(opts.userId, filePath, { caption: '🎵 WebApp orqali yuklandi' });
    } catch (e: any) { logger.warn(`Bot media send skipped for ${opts.userId}: ${e.message}`); }
  }
  res.download(filePath, filename, (err: any) => {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    if (err && !res.headersSent) res.status(500).json({ error: 'Download failed' });
  });
};
