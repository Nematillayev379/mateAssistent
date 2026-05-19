import express from 'express';
import rateLimit from 'express-rate-limit';
import { logger } from '../utils/logger';
import { DBService } from './database';
import { CONFIG, isOwnerId } from '../config/config';
import { bot, generateDashboardToken } from './bot_instance';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { MusicService } from './music';
import { PaymentService } from './payment';
import { generateSmmImage, generateSmmPost, getActiveKeyStats, getSmartAIResponse, refreshKeyPool, validateKey } from './ai';
import { buildKeyPoolFromEnv, countKeysByProvider, getEnvKeySourceReport } from '../config/config';
import { ScraperService } from './scraper';
import { FinanceService } from './finance';
import { TelegramMonitorService, normalizeTelegramChannelId } from './telegram_monitor';
import { TrendsService } from './trends';
import { generateTTS, generateAudioSummary } from './ai';
import { safeSendToChannels } from './telegram';

// B-51 Fix: Add proper type for bot parameter
export function startDashboardServer(port: number | string, _bot?: any) {
  const app = express();

  app.use(express.json());
  // B-21 Fix: Add CORS middleware manually
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      const allowedOrigins = [CONFIG.PUBLIC_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'];
      if (allowedOrigins.some(o => o && origin.startsWith(o))) {
        res.header('Access-Control-Allow-Origin', origin);
      } else {
        res.header('Access-Control-Allow-Origin', '*');
      }
    } else {
      res.header('Access-Control-Allow-Origin', '*');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-bot-token, x-user-id');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });
  // B-20 Fix: Use process.cwd() instead of __dirname for tsx compatibility
  app.use(express.static(path.join(process.cwd(), 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    }
  }));

  // BUG-154 Fix: Rate limiting on API endpoints
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' },
    // BUG-102 Fix: Exclude webhook from rate limiting
    skip: (req) => req.path === '/api/bot/webhook'
  });
  app.use('/api/', apiLimiter);

  // Extra rate limit for AI endpoint
  const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: async (req: any) => {
      const userId = req.headers['x-user-id'] || req.query.userId || req.query.user || req.body?.userId;
      if (userId) {
        const isPremium = await DBService.isPremiumActive(parseInt(userId as string));
        return isPremium ? 30 : 10;
      }
      return 10;
    },
    message: { error: 'AI request limit exceeded.' }
  });

  app.get('/health', (req, res) => res.json({ status: 'ok', bot: 'active' }));
  app.post('/api/bot/webhook', async (req, res) => {
    try { await bot.processUpdate(req.body); res.sendStatus(200); } catch (e: any) { res.sendStatus(500); }
  });

  // BUG-055/056 Fix: Unified auth with consistent userId extraction
  const extractUserId = (req: any) => {
    return String(
      req.headers['x-user-id'] ||
      req.params.userId ||
      req.query.userId ||
      req.query.user ||
      req.body?.userId ||
      ''
    );
  };

  const timingSafeCompare = (str1: string, str2: string): boolean => {
    if (!str1 || !str2) return false;
    const h1 = crypto.createHmac('sha256', 'timing-safe-salt').update(str1).digest();
    const h2 = crypto.createHmac('sha256', 'timing-safe-salt').update(str2).digest();
    return crypto.timingSafeEqual(h1, h2);
  };

  const checkAuth = (req: any, res: any, next: any) => {
    const token = req.headers['x-bot-token'] || req.query.token || (req.headers.authorization?.split(' ')[1] ?? '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    if (token && CONFIG.DASHBOARD_SECRET && timingSafeCompare(token, CONFIG.DASHBOARD_SECRET)) {
      if (CONFIG.OWNER_ID == null) {
        return res.status(500).json({ error: 'Owner ID not configured' });
      }
      req.authenticatedUserId = String(CONFIG.OWNER_ID);
      return next();
    }

    const userId = extractUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    if (token !== generateDashboardToken(userId)) {
      return res.status(401).json({ error: 'Invalid token for this user' });
    }
    req.authenticatedUserId = userId;
    
    // Auto-sync owner role for webapp users
    if (isOwnerId(parseInt(userId))) {
        DBService.getUser(parseInt(userId)).then((user: any) => {
            if (user && user.role !== 'owner') {
                DBService.updateUserRole(parseInt(userId), 'owner');
            }
        }).catch(() => {});
    }

    next();
  };

  // WebApp InitData Verification
  const verifyTelegramWebAppData = (telegramInitData: string): any => {
    try {
      const initData = new URLSearchParams(telegramInitData);
      const hash = initData.get('hash');
      if (!hash) return null;

      const authDate = initData.get('auth_date');
      if (!authDate) return null;
      const authTs = parseInt(authDate, 10);
      if (isNaN(authTs) || Math.abs(Date.now() / 1000 - authTs) > 3600) return null;

      initData.delete('hash');
      const keys = Array.from(initData.keys()).sort();
      const dataCheckString = keys.map(key => `${key}=${initData.get(key)}`).join('\n');
      
      const secretKey = crypto.createHmac('sha256', 'WebAppData').update((CONFIG.TELEGRAM_TOKEN || '').trim()).digest();
      const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
      
      if (calculatedHash === hash) {
        const userStr = initData.get('user');
        return userStr ? JSON.parse(userStr) : null;
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  app.post('/api/auth/telegram', async (req, res) => {
    const { initData } = req.body;
    if (!initData) return res.status(400).json({ error: 'Missing initData' });
    
    const tgUser = verifyTelegramWebAppData(initData);
    if (!tgUser || !tgUser.id) return res.status(401).json({ error: 'Invalid Telegram data' });
    
    let user = await DBService.getUser(tgUser.id);
    if (!user) {
      user = await DBService.upsertUser(tgUser.id, isOwnerId(tgUser.id) ? 1 : 0, tgUser.username, tgUser.first_name);
      if (!user) return res.status(500).json({ error: 'User not found and creation failed' });
    }

    // Sync env owner to DB role (same as /start) so WebApp shows admin panel
    if (isOwnerId(tgUser.id) && user.role !== 'owner') {
      await DBService.updateUserRole(tgUser.id, 'owner');
      user.role = 'owner';
    }
    
    const token = generateDashboardToken(tgUser.id);
    res.json({ token, userId: tgUser.id, role: user.role || 'user' });
  });

  app.post('/api/auth/master', async (req, res) => {
    const { token } = req.body;
    if (token && CONFIG.DASHBOARD_SECRET && timingSafeCompare(token, CONFIG.DASHBOARD_SECRET)) {
      if (CONFIG.OWNER_ID == null) {
        return res.status(500).json({ error: 'Owner ID not configured' });
      }
      const ownerId = CONFIG.OWNER_ID as number;
      let user = await DBService.getUser(ownerId);
      if (!user) {
         user = await DBService.upsertUser(ownerId, 1, 'Owner', 'Owner');
      }
      if (user && user.role !== 'owner') {
        await DBService.updateUserRole(ownerId, 'owner');
        user.role = 'owner';
      }
      res.json({ token, userId: ownerId, role: user?.role || 'owner' });
    } else {
      // BUG-H4: Add a 1.5s delay to prevent master brute-force attacks
      await new Promise(resolve => setTimeout(resolve, 1500));
      res.status(401).json({ error: 'Invalid master token' });
    }
  });

  // BUG-056 Fix: Same userId extraction order as checkAuth
  const checkAdmin = async (req: any, res: any, next: any) => {
    const token = req.headers['x-bot-token'] || req.query.token || (req.headers.authorization?.split(' ')[1] ?? '');
    const adminId = extractUserId(req);
    
    if (token && CONFIG.DASHBOARD_SECRET && timingSafeCompare(token, CONFIG.DASHBOARD_SECRET)) {
      if (CONFIG.OWNER_ID == null) {
        return res.status(500).json({ error: 'Owner ID not configured' });
      }
      req.authenticatedUserId = String(CONFIG.OWNER_ID);
      return next();
    }

    if (!adminId || !token) return res.status(401).json({ error: 'Unauthorized' });
    if (token !== generateDashboardToken(adminId)) return res.status(401).json({ error: 'Invalid admin token' });
    
    const adminUid = parseInt(adminId);
    const user = await DBService.getUser(adminUid);
    const isAdmin = user && (
      user.role === 'owner' || user.role === 'admin' ||
      user.is_owner === 1 || isOwnerId(adminUid)
    );
    if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access only' });
    req.authenticatedUserId = adminId;
    next();
  };

  // --- API ---
  app.get('/api/dashboard-info', checkAuth, async (req: any, res: any) => {
    // BUG-123/BUG-083 Fix: Use authenticatedUserId
    const userId = parseInt(req.authenticatedUserId);
    const user = await DBService.getUser(userId);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const effectiveRole = user.role || (user.is_owner ? 'owner' : 'user');
    res.json({
      user: {
        id: user.telegram_id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        role: effectiveRole,
        is_owner: !!user.is_owner,
        is_premium: !!user.is_premium,
        is_approved: !!user.is_approved,
        is_active: user.is_active !== 0,
        target_channel: user.target_channel || null,
        language: user.language || 'uz',
        premium_until: user.premium_until || null
      },
      stats: await DBService.getStats(userId),
      scheduled: await DBService.getUserScheduledPosts(userId),
      referrals: await DBService.getReferralStats(userId),
      tickets: (user.role === 'owner' || user.role === 'admin') ? await DBService.getTickets() : await DBService.getUserTickets(userId)
    });
  });

  app.get('/api/user/:userId', checkAuth, async (req: any, res: any) => {
    // BUG-123/BUG-083 Fix: Use authenticatedUserId to prevent IDOR
    const u = await DBService.getUser(parseInt(req.authenticatedUserId));
    res.json(u ? { ...u, api_key_count: await DBService.getUserApiKeyCount(u.telegram_id) } : { error: 'Not found' });
  });

  app.get('/api/sources/:userId', checkAuth, async (req: any, res: any) => {
    // BUG-124/BUG-084 Fix: Use authenticatedUserId
    res.json(await DBService.getUserSources(parseInt(req.authenticatedUserId)));
  });

  // BUG-058 Fix: Admin limit calculation included
  app.post('/api/sources/:userId', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { name, url, lang } = req.body;
    
    // BUG-H2: SSRF Prevention URL Validation
    if (!url || !url.startsWith('http')) return res.status(400).json({ error: 'Invalid URL' });
    try {
      const u = new URL(url);
      if (['localhost', '127.0.0.1'].includes(u.hostname) || u.hostname.startsWith('192.168.') || u.hostname.startsWith('10.')) {
        throw new Error();
      }
    } catch {
      return res.status(400).json({ error: 'Private URLs not allowed' });
    }

    const discovered = await ScraperService.discoverRSS(url);
    // BUG-024 Fix: Better error message for RSS discovery failure
    if (!discovered) return res.status(400).json({ error: 'URL yaroqli RSS/Atom formatida emas yoki server bloklagan.' });

    const user = await DBService.getUser(uid);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const sources = await DBService.getUserSources(uid);
    if (!(await DBService.checkUserLimit(uid, 'sources'))) return res.status(403).json({ error: 'Limit reached' });
    await DBService.addSource(uid, name, discovered, lang || 'uz');
    res.json({ success: true });
  });

  app.delete('/api/sources/:userId/:id', checkAuth, async (req: any, res: any) => {
    // BUG-H3: IDOR Prevention Validation
    const sourceId = parseInt(req.params.id);
    if (!sourceId || sourceId <= 0 || isNaN(sourceId)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
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
    res.json({
      language: u.language,
      target_channel: u.target_channel,
      is_active: u.is_active,
      is_premium: u.is_premium
    });
  });

  app.post('/api/settings/:userId', checkAuth, async (req: any, res: any) => {
    const { language, target_channel } = req.body;
    await DBService.updateUser(parseInt(req.authenticatedUserId), { language, target_channel });
    res.json({ success: true });
  });

  // --- ADMIN ENDPOINTS ---
  app.get('/api/admin/users', checkAdmin, async (req, res) => {
    const users = await DBService.getAllUsers();
    // Add additional info like source counts for the dashboard
    for (const u of users) {
      u.sources = await DBService.getUserSources(u.telegram_id);
    }
    res.json(users);
  });

  app.get('/api/admin/sources', checkAdmin, async (req, res) => {
    res.json(await DBService.getAllSources());
  });

  app.get('/api/admin/settings', checkAdmin, async (req, res) => {
    const starsPrice = await DBService.getSetting('premium_stars_price') || '500';
    const monthlyPrice = await DBService.getPrice('monthly');
    const yearlyPrice = await DBService.getPrice('yearly');
    res.json({
      premium_stars_price: starsPrice,
      price_monthly: monthlyPrice,
      price_yearly: yearlyPrice
    });
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
    if (!['owner', 'admin', 'user', 'premium'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const callerId = parseInt(req.authenticatedUserId);
    const callerIsOwner = isOwnerId(callerId);

    // Only the real owner can promote someone to admin or owner
    if ((role === 'owner' || role === 'admin') && !callerIsOwner) {
      return res.status(403).json({ error: 'Faqat Owner boshqalarni admin qila oladi' });
    }

    // Never allow assigning 'owner' role via API, it should only be defined via env
    if (role === 'owner') {
      return res.status(403).json({ error: 'Owner rolini API orqali berish taqiqlangan' });
    }

    await DBService.updateUserRole(parseInt(req.params.telegramId), role);
    res.json({ success: true });
  });

  app.get('/api/admin/prices', checkAdmin, async (req, res) => res.json({
    monthly: await DBService.getPrice('monthly'),
    yearly: await DBService.getPrice('yearly'),
    stars: await DBService.getSetting('premium_stars_price') || '500'
  }));

  app.post('/api/admin/users/:telegramId/premium', checkAdmin, async (req, res) => {
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

  app.post('/api/admin/users/:telegramId/unblock', checkAdmin, async (req, res) => {
    await DBService.updateUser(parseInt(req.params.telegramId), { is_active: 1 });
    res.json({ success: true });
  });

  app.post('/api/admin/users/:telegramId/reject', checkAdmin, async (req, res) => {
    await DBService.updateUser(parseInt(req.params.telegramId), { is_approved: 0 });
    res.json({ success: true });
  });

  app.get('/api/payments/methods', checkAuth, async (_req, res) => {
    res.json(PaymentService.getAvailableMethods());
  });

  // BUG-059 Fix: Actually ping Redis to check connection
  app.get('/api/admin/system', checkAdmin, async (req, res) => {
    let redisStatus = false;
    try {
      const redis = (await import('../services/redis')).getRedisConnection();
      if (redis) {
        await redis.ping();
        redisStatus = true;
      }
    } catch {}
    
    const envPool = buildKeyPoolFromEnv();
    const active = getActiveKeyStats();
    res.json({
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      redis: redisStatus,
      ownerId: CONFIG.OWNER_ID,
      nodeVersion: process.version,
      aiKeys: {
        envLoaded: envPool.length,
        activeLoaded: active.total,
        envByProvider: countKeysByProvider(envPool),
        activeByProvider: active.byProvider,
        envVarCounts: getEnvKeySourceReport(),
      },
    });
  });

  app.post('/api/admin/ai-keys/refresh', checkAdmin, async (_req, res) => {
    await refreshKeyPool();
    res.json({ success: true, ...getActiveKeyStats() });
  });

  // BUG-085 Fix: Admin broadcast rate limit applied via aiLimiter (or custom)
  app.post('/api/admin/broadcast', checkAdmin, aiLimiter, async (req: any, res: any) => {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Invalid broadcast message' });
    }

    const users = await DBService.getAllUsers();
    const queued = users.length;
    setImmediate(async () => {
      let count = 0;
      for (const user of users) {
        try {
          await bot.sendMessage(user.telegram_id, message, { parse_mode: 'HTML' });
          count++;
          await new Promise(r => setTimeout(r, 40));
        } catch (e: any) {
          logger.warn(`Broadcast failed for ${user.telegram_id}: ${e.message}`);
        }
      }
      logger.info(`Broadcast finished: ${count}/${queued} messages sent.`);
    });

    res.status(202).json({ success: true, queued });
  });

  app.get('/api/music/search', checkAuth, async (req, res) => res.json(await MusicService.getYouTubeVideoIds(req.query.q as string, 8)));
  
  const cleanupTempFile = (filePath: string) => {
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  };

  const serveFileDownload = async (
    res: any,
    filePath: string,
    filename: string,
    opts?: { userId?: number; notifyBot?: 'audio' | 'video' }
  ) => {
    if (opts?.notifyBot && opts.userId) {
      try {
        if (opts.notifyBot === 'video') {
          await bot.sendVideo(opts.userId, filePath, { caption: '📥 WebApp orqali yuklandi' });
        } else {
          await bot.sendAudio(opts.userId, filePath, { caption: '🎵 WebApp orqali yuklandi' });
        }
      } catch (e: any) {
        logger.warn(`Bot media send skipped for ${opts.userId}: ${e.message}`);
      }
    }

    res.download(filePath, filename, (err: any) => {
      cleanupTempFile(filePath);
      if (err && !res.headersSent) {
        res.status(500).json({ error: err.message || 'Download failed' });
      }
    });
  };

  app.get('/api/debug/ytdlp', async (req: any, res: any) => {
    try {
      const { resolveYtDlpPath } = await import('../utils/ytdlp');
      const ytdlpPath = await resolveYtDlpPath();
      const fsExists = ytdlpPath ? fs.existsSync(ytdlpPath) : false;
      const size = fsExists && ytdlpPath ? fs.statSync(ytdlpPath).size : 0;
      let version = 'not found';
      let execErr = '';
      let pythonVersion = 'not checked';
      
      try {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execPromise = promisify(exec);
        const { stdout } = await execPromise('python3 --version', { timeout: 3000 });
        pythonVersion = stdout.trim();
      } catch (e: any) {
        pythonVersion = `error: ${e.message}`;
      }

      if (ytdlpPath) {
        try {
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execPromise = promisify(exec);
          const cmd = ytdlpPath.includes(' ') || ytdlpPath.includes('\\') ? `"${ytdlpPath}"` : ytdlpPath;
          const { stdout, stderr } = await execPromise(`${cmd} --version`, { timeout: 5000 });
          version = stdout.trim();
        } catch (e: any) {
          execErr = `${e.message}\nSTDOUT: ${e.stdout || ''}\nSTDERR: ${e.stderr || ''}`;
        }
      }
      res.json({
        ytdlpPath,
        fsExists,
        size,
        version,
        pythonVersion,
        execErr,
        cwd: process.cwd(),
        __dirname,
        candidates: [
          path.join(__dirname, '..', '..', 'yt-dlp'),
          path.join(__dirname, '..', '..', 'yt-dlp.exe'),
          path.join(process.cwd(), 'yt-dlp'),
          path.join(process.cwd(), 'yt-dlp.exe'),
        ].map(p => ({ path: p, exists: fs.existsSync(p) }))
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/music/download/:id', checkAuth, async (req: any, res: any) => {
    const videoId = req.params.id;
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return res.status(400).json({ error: 'Invalid video ID' });
    }
    const userId = parseInt(req.authenticatedUserId);
    const webOnly = req.query.web === '1';
    try {
      const { downloadYouTube } = await import('../services/youtube');
      const url = `https://youtube.com/watch?v=${videoId}`;
      const filePath = await downloadYouTube(url, 'audio');
      const filename = `music_${videoId}.m4a`;

      await serveFileDownload(res, filePath, filename, {
        userId,
        notifyBot: webOnly ? undefined : 'audio',
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/media/download', checkAuth, async (req: any, res: any) => {
    const { url, type } = req.body; // type: 'video' | 'audio'
    const userId = parseInt(req.authenticatedUserId);
    const webOnly = req.query.web === '1' || req.body?.delivery === 'web';
    if (!['video', 'audio'].includes(type)) {
      return res.status(400).json({ error: 'Invalid media type' });
    }
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    try {
      const { downloadYouTube } = await import('../services/youtube');
      const filePath = await downloadYouTube(url, type);
      const ext = type === 'video' ? 'mp4' : 'm4a';
      const filename = `media_${Date.now()}.${ext}`;

      await serveFileDownload(res, filePath, filename, {
        userId,
        notifyBot: webOnly ? undefined : (type === 'video' ? 'video' : 'audio'),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/finance/prices', checkAuth, async (req, res) => {
    try {
      const crypto = await FinanceService.getCryptoPrices();
      const usd = await FinanceService.getUSDRate();
      res.json({ btc: crypto.BTC || 'N/A', usd: usd || 'N/A' });
    } catch (e) {
      res.json({ btc: 'N/A', usd: 'N/A' });
    }
  });

  // BUG-060 Fix: Parse withImage as boolean properly
  app.post('/api/ai/smm', checkAuth, aiLimiter, async (req: any, res: any) => {
    const { prompt, withImage } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      return res.status(400).json({ error: 'Prompt bo\'sh bo\'lishi mumkin emas.' });
    }

    const topic = prompt.trim();
    const wantImage = withImage === true || withImage === 'true';

    try {
      const text = await generateSmmPost(topic);

      let imageUrl: string | null = null;
      let imageBase64: string | null = null;
      if (wantImage) {
        const img = await generateSmmImage(topic);
        imageUrl = img.imageUrl;
        imageBase64 = img.imageBase64;
      }

      res.json({ text, imageUrl, imageBase64 });
    } catch (e: any) {
      logger.error(`SMM generate error: ${e.message}`);
      res.status(500).json({ error: e.message || 'AI xatolik' });
    }
  });

  app.post('/api/ai/post-to-channel', checkAuth, async (req: any, res: any) => {
    const { text, imageUrl, imageBase64 } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Invalid text' });

    const user = await DBService.getUser(parseInt(req.authenticatedUserId));
    if (!user?.target_channel) {
      return res.status(400).json({ error: 'No channel configured' });
    }

    if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.startsWith('data:image')) {
      const base64Data = imageBase64.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      await bot.sendPhoto(user.target_channel, buffer, { caption: text });
    } else if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
      await bot.sendPhoto(user.target_channel, imageUrl, { caption: text });
    } else {
      await bot.sendMessage(user.target_channel, text);
    }
    res.json({ success: true });
  });

  app.get('/api/tracker/search', checkAuth, async (req: any, res: any) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string' || q.trim() === '') {
      return res.status(400).json({ error: 'Qidiruv so\'rovi kiritilmagan' });
    }
    try {
      const { PriceTrackerService } = await import('./pricetracker');
      const results = await PriceTrackerService.searchProducts(q.trim());
      const sorted = results.sort((a, b) => a.price - b.price);
      res.json(sorted);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // --- PRICE TRACKER ---
  app.get('/api/prices/:userId', checkAuth, async (req: any, res: any) => {
    const prices = await DBService.getTrackedPrices(parseInt(req.authenticatedUserId));
    res.json(prices);
  });

  app.post('/api/prices/:userId', checkAuth, async (req: any, res: any) => {
    const { url, name, price } = req.body;
    const parsedPrice = Number(price);
    if (!url || typeof url !== 'string' || !name || typeof name !== 'string' || Number.isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ error: 'Invalid price tracker payload' });
    }
    try {
      let finalName = name;
      let finalPrice = parsedPrice;

      if (finalName === 'Tovar' || finalPrice === 0) {
        try {
          const { PriceTrackerService } = await import('./pricetracker');
          const resolved = await PriceTrackerService.fetchPrice(url);
          if (resolved) {
            finalName = resolved.title;
            finalPrice = resolved.price;
          }
        } catch {}
      }

      await DBService.addTrackedPrice(parseInt(req.authenticatedUserId), url, finalName, finalPrice);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.delete('/api/prices/:userId/:id', checkAuth, async (req: any, res: any) => {
    await DBService.removePrice(parseInt(req.authenticatedUserId), parseInt(req.params.id));
    res.json({ success: true });
  });

  // --- MONITORED CHANNELS ---
  app.get('/api/channels/:userId', checkAuth, async (req: any, res: any) => {
    const channels = await DBService.getUserMonitoredChannels(parseInt(req.authenticatedUserId));
    res.json(channels);
  });

  app.post('/api/channels/:userId', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { platform, channelId, name, forward_mode, use_ai } = req.body;
    const allowedPlatforms = ['youtube', 'instagram', 'telegram'];
    if (!allowedPlatforms.includes(platform) || !channelId) {
      return res.status(400).json({ error: 'Invalid channel payload' });
    }

    let resolvedId = channelId;
    let resolvedName = name || channelId;

    if (platform === 'telegram') {
      const verify = await TelegramMonitorService.verifyBotInSourceChannel(channelId);
      if (!verify.ok) return res.status(400).json({ error: verify.error || 'Bot manba kanalda admin emas' });
      resolvedId = verify.chatId || normalizeTelegramChannelId(channelId);
      resolvedName = verify.title || resolvedName;
    }

    if (!(await DBService.checkUserLimit(uid, 'channels'))) {
      return res.status(403).json({ error: 'Channel limit reached' });
    }

    await DBService.addMonitoredChannel(uid, platform, resolvedId, resolvedName, {
      forward_mode: forward_mode || 'copy',
      use_ai: use_ai ? 1 : 0,
    });
    res.json({ success: true, channelId: resolvedId, name: resolvedName });
  });

  app.patch('/api/channels/:userId/:id', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const id = parseInt(req.params.id);
    const { forward_mode, use_ai, is_active } = req.body;
    const updates: Record<string, any> = {};
    if (forward_mode) updates.forward_mode = forward_mode;
    if (use_ai !== undefined) updates.use_ai = use_ai ? 1 : 0;
    if (is_active !== undefined) updates.is_active = is_active ? 1 : 0;
    await DBService.updateMonitoredChannelSettings(id, uid, updates);
    res.json({ success: true });
  });

  app.delete('/api/channels/:userId/:id', checkAuth, async (req: any, res: any) => {
    await DBService.removeMonitoredChannel(parseInt(req.authenticatedUserId), parseInt(req.params.id));
    res.json({ success: true });
  });

  // --- MULTI-CHANNEL OUTPUT ---
  app.get('/api/output-channels/:userId', checkAuth, async (req: any, res: any) => {
    const u = await DBService.getUser(parseInt(req.authenticatedUserId));
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json({ primary: u.target_channel, extra: u.extra_channels || '', all: DBService.getUserOutputChannels(u) });
  });

  app.post('/api/output-channels/:userId', checkAuth, async (req: any, res: any) => {
    const { channels } = req.body;
    if (!Array.isArray(channels)) return res.status(400).json({ error: 'channels array required' });
    await DBService.setExtraChannels(parseInt(req.authenticatedUserId), channels);
    res.json({ success: true });
  });

  // --- UZ TRENDS RADAR ---
  app.get('/api/trends/uz', checkAuth, async (req: any, res: any) => {
    const force = req.query.refresh === '1' || req.query.refresh === 'true';
    try {
      const data = await TrendsService.scanUZTrends(force);
      res.json(data);
    } catch (e: any) {
      const cached = await DBService.getLatestTrendsSnapshot();
      if (cached) return res.json({ topics: cached.topics, summary: cached.summary, at: cached.created_at });
      res.status(500).json({ error: e.message });
    }
  });

  // --- AI VOICE NEWS ---
  app.post('/api/ai/voice-news', checkAuth, aiLimiter, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { text, title, sendToChannel } = req.body;
    const user = await DBService.getUser(uid);
    if (!user) return res.status(404).json({ error: 'Not found' });

    const script = text || await generateAudioSummary(title || 'Yangilik', title || '');
    const audio = await generateTTS(script);
    if (!audio) return res.status(500).json({ error: 'Ovoz generatsiyasi muvaffaqiyatsiz' });

    const caption = `🎙 <b>${title || 'AI Ovoz Yangilik'}</b>\n\n${script.slice(0, 500)}`;
    const targets = sendToChannel ? DBService.getUserOutputChannels(user) : [uid];

    for (const ch of targets) {
      try {
        const chatId = sendToChannel ? ch : uid;
        await bot.sendAudio(chatId, audio, { caption, parse_mode: 'HTML' });
      } catch (e: any) {
        logger.warn(`Voice send failed ${ch}: ${e.message}`);
      }
    }
    res.json({ success: true, script: script.slice(0, 800) });
  });

  // --- VISUAL POST COMPOSER (multi-channel) ---
  app.post('/api/posts/publish', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { text, imageUrl, channels } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Text required' });

    const user = await DBService.getUser(uid);
    if (!user) return res.status(404).json({ error: 'Not found' });

    const targets: string[] = Array.isArray(channels) && channels.length
      ? channels
      : DBService.getUserOutputChannels(user);

    if (!targets.length) return res.status(400).json({ error: 'No output channels configured' });

    await safeSendToChannels(user, targets, async (target) => {
      if (imageUrl) {
        await bot.sendPhoto(target, imageUrl, { caption: text, parse_mode: 'HTML' });
      } else {
        await bot.sendMessage(target, text, { parse_mode: 'HTML' });
      }
    });

    await DBService.incrementStat(uid, 'total_posts');
    res.json({ success: true, sentTo: targets.length });
  });

  app.post('/api/posts/draft', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { title, body, image_url, channels } = req.body;
    if (!body) return res.status(400).json({ error: 'Body required' });
    const draft = await DBService.savePostDraft(uid, { title, body, image_url, channels });
    res.json({ success: true, draft });
  });

  app.get('/api/posts/drafts/:userId', checkAuth, async (req: any, res: any) => {
    const drafts = await DBService.getUserPostDrafts(parseInt(req.authenticatedUserId));
    res.json(drafts);
  });

  // --- SUPPORT TICKETS ---
  // BUG-FIX: /api/tickets/all must be registered BEFORE /api/tickets/:userId
  // otherwise Express matches 'all' as a :userId param and this route is never reached.
  app.get('/api/tickets/all', checkAdmin, async (req, res) => {
    const tickets = await DBService.getTickets();
    res.json(tickets);
  });

  app.get('/api/tickets/:userId', checkAuth, async (req: any, res: any) => {
    const tickets = await DBService.getUserTickets(parseInt(req.authenticatedUserId));
    res.json(tickets);
  });

  app.post('/api/tickets/:userId', checkAuth, async (req: any, res: any) => {
    const { subject, message } = req.body;
    const ticket = await DBService.createTicket(parseInt(req.authenticatedUserId), subject, message);
    res.json(ticket);
  });

  // --- REFERRAL SYSTEM ---
  app.get('/api/referral/:userId', checkAuth, async (req: any, res: any) => {
    const code = await DBService.ensureReferralCode(parseInt(req.authenticatedUserId));
    const stats = await DBService.getReferralStats(parseInt(req.authenticatedUserId));
    const botMe = await bot.getMe();
    const refLink = `https://t.me/${botMe.username}?start=ref_${code}`;
    res.json({ code, stats, refLink });
  });

  // --- SCHEDULED POSTS ---
  app.get('/api/scheduled/:userId', checkAuth, async (req: any, res: any) => {
    const posts = await DBService.getUserScheduledPosts(parseInt(req.authenticatedUserId));
    res.json(posts);
  });

  app.post('/api/scheduled/:userId', checkAuth, async (req: any, res: any) => {
    const { type, content, scheduledAt } = req.body;
    if (!['video', 'audio', 'text'].includes(type) || !content || !scheduledAt || isNaN(Date.parse(scheduledAt))) {
      return res.status(400).json({ error: 'Invalid scheduled post payload' });
    }
    try {
      await DBService.addScheduledPost(parseInt(req.authenticatedUserId), type, content, scheduledAt);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message || 'Invalid scheduled post' });
    }
  });

  app.delete('/api/scheduled/:userId/:id', checkAuth, async (req: any, res: any) => {
    await DBService.cancelScheduledPost(parseInt(req.authenticatedUserId), parseInt(req.params.id));
    res.json({ success: true });
  });

  // --- API KEYS ---
  app.get('/api/keys/:userId', checkAuth, async (req: any, res: any) => {
    const keys = await DBService.getUserApiKeys(parseInt(req.authenticatedUserId));
    res.json(keys);
  });

  app.post('/api/keys/:userId', checkAuth, async (req: any, res: any) => {
    const { key, type } = req.body;
    if (!key || !type || typeof key !== 'string' || typeof type !== 'string') {
      return res.status(400).json({ error: 'Invalid api key payload' });
    }
    const validTypes = ['groq', 'cerebras', 'openrouter', 'gemini', 'openai', 'google'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Unsupported API key type' });
    }
    const isValid = await validateKey(type as any, key);
    if (!isValid) return res.status(400).json({ error: 'API key validation failed' });

    await DBService.addApiKey(parseInt(req.authenticatedUserId), key, type);
    res.json({ success: true });
  });

  // --- USER SETTINGS EXTENDED ---
  app.get('/api/settings/:userId/extended', checkAuth, async (req: any, res: any) => {
    const u = await DBService.getUser(parseInt(req.authenticatedUserId));
    if (!u) return res.status(404).json({ error: 'Not found' });
    const keywords = await DBService.getKeywords(parseInt(req.authenticatedUserId));
    res.json({
      language: u.language,
      target_channel: u.target_channel,
      is_active: u.is_active,
      is_premium: u.is_premium,
      keywords: keywords.join(', '),
      daily_digest: u.daily_digest,
      digest_time: u.digest_time,
      schedule_times: u.schedule_times
    });
  });

  app.post('/api/settings/:userId/extended', checkAuth, async (req: any, res: any) => {
    const { language, target_channel, keywords, daily_digest, digest_time, schedule_times } = req.body;
    await DBService.updateUser(parseInt(req.authenticatedUserId), { language, target_channel, daily_digest, digest_time, schedule_times });
    if (keywords !== undefined) await DBService.setKeywords(parseInt(req.authenticatedUserId), keywords);
    res.json({ success: true });
  });

  // BUG-061 Fix: Use DB prices instead of hardcoded
  app.get('/api/premium-info', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId as string);
    const priceMonthly = await DBService.getPrice('monthly');
    const priceYearly = await DBService.getPrice('yearly');
    const isActive = await DBService.isPremiumActive(uid);
    let expiresAt = null;
    if (isActive) {
      const user = await DBService.getUser(uid);
      expiresAt = user?.premium_until;
    }
    const benefits = [
      '10 ta RSS manba',
      'Cheksiz kanal monitoring',
      'Cheksiz schedule post',
      'AI prioritet (30/min)',
      'Kunlik digest',
      'Premium badge va oltin tema'
    ];
    const starsPrice = parseInt(await DBService.getSetting('premium_stars_price') || '500');
    const starsYearlyPrice = starsPrice * 10;
    res.json({ 
      monthlyPrice: priceMonthly, 
      yearlyPrice: priceYearly, 
      starsPrice,
      starsYearlyPrice,
      isActive, 
      expiresAt, 
      benefits 
    });
  });

  app.post('/api/premium/buy', checkAuth, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId as string);
    const { method, plan } = req.body;
    const isYearly = plan === 'yearly';
    
    if (method === 'stars') {
      const starsPrice = parseInt(await DBService.getSetting('premium_stars_price') || '500');
      const price = isYearly ? starsPrice * 10 : starsPrice;
      const title = isYearly ? 'mateAssistent Premium (1 Year)' : 'mateAssistent Premium (1 Month)';
      const invoice = await bot.createInvoiceLink(
        title, 'Premium access for news automation', 
        `premium_sub_${uid}${isYearly ? '_yearly' : ''}`, 
        '', 'XTR', [{ label: 'Premium', amount: price }]
      );
      return res.json({ success: true, url: invoice, method: 'stars' });
    }

    if (method === 'payme') {
      const amount = isYearly ? await DBService.getPrice('yearly') : await DBService.getPrice('monthly');
      const link = await PaymentService.generatePaymeLink(uid, amount);
      if (!link) return res.status(503).json({ error: 'Payme sozlanmagan (PAYME_MERCHANT_ID)' });
      return res.json({ success: true, url: link, method: 'payme' });
    }

    if (method === 'click') {
      const amount = isYearly ? await DBService.getPrice('yearly') : await DBService.getPrice('monthly');
      const link = await PaymentService.generateClickLink(uid, amount);
      if (!link) return res.status(503).json({ error: 'Click sozlanmagan (CLICK_SERVICE_ID)' });
      return res.json({ success: true, url: link, method: 'click' });
    }

    res.status(400).json({ error: 'Unsupported method' });
  });

  app.delete('/api/keys/:userId', checkAuth, async (req: any, res: any) => {
    const { key } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'API key required' });
    }
    await DBService.removeApiKey(parseInt(req.authenticatedUserId), key);
    res.json({ success: true });
  });

  // BUG-062 Fix: Require PAYME_KEY for webhook processing
  app.post('/api/payments/payme', async (req, res) => {
    try {
      if (!process.env.PAYME_KEY) {
        logger.warn('🚫 Payme webhook rejected: PAYME_KEY not configured');
        // BUG-087 Fix: Return 200 to prevent Payme from sending spam retries
        return res.status(200).json({ error: { code: -32504, message: 'Payment not configured' } });
      }
      res.json(await PaymentService.handlePaymeWebhook(req.body, req.headers));
    } catch (e: any) {
      logger.error(`Payme webhook failed: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // BUG-065 Fix: Error handling for sendFile
  app.use('/dashboard', (req, res) => {
    const filePath = path.join(process.cwd(), 'public', 'index.html');
    res.sendFile(filePath, (err) => {
      // BUG-101 Fix: Check headersSent to avoid exception
      if (err && !res.headersSent) res.status(404).json({ error: 'Dashboard not found' });
    });
  });
  
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
    const filePath = path.join(process.cwd(), 'public', 'index.html');
    res.sendFile(filePath, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Page not found' });
    });
  });

  // BUG-064 Fix: app.listen is called here
  app.listen(port, () => logger.info(`🖥 Dashboard on ${port}`));
  return app;
}
