import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { CONFIG, isOwnerId } from '../../config/config';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { checkAuth, timingSafeCompare, verifyTelegramWebAppData } from '../auth';
import { generateDashboardToken } from '../../services/bot_instance';
import { logger } from '../../utils/logger';
import { createSession, setSessionCookie, clearSessionCookie, destroySession } from '../session';

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** Reserve IDs >= 900000000 for web-only accounts */
const WEB_ID_START = 900_000_000;

function nextWebUserId(users: Array<{ telegram_id: number }>): number {
  const existing = users.map(u => u.telegram_id).filter((id: number) => id >= WEB_ID_START);
  return existing.length > 0 ? Math.max(...existing) + 1 : WEB_ID_START;
}

export function registerAuthRoutes(app: express.Application) {
  const authLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Too many attempts. Try again later.' } });
  const masterLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, message: { error: 'Too many attempts. Try again later.' } });

  app.post('/api/auth/telegram', async (req: Request, res: Response) => {
    try {
      const { initData } = req.body;
      if (!initData) return res.status(400).json({ error: 'Missing initData' });
      const tgUser = verifyTelegramWebAppData(initData) as TelegramUser | null;
      if (!tgUser || !tgUser.id) return res.status(401).json({ error: 'Invalid Telegram data' });
      let user = await DBService.getUser(tgUser.id);
      if (!user) user = await DBService.upsertUser(tgUser.id, isOwnerId(tgUser.id) ? 1 : 0, tgUser.username, tgUser.first_name);
      if (!user) return res.status(500).json({ error: 'User creation failed' });
      if (isOwnerId(tgUser.id) && user.role !== 'owner') {
        await DBService.updateUserRole(tgUser.id, 'owner');
        user.role = 'owner';
      }
      const token = generateDashboardToken(tgUser.id);
      res.json({ token, userId: tgUser.id, role: user.role || 'user' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`POST /api/auth/telegram failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/auth/verify', authLimiter, async (req: Request, res: Response) => {
    try {
      const { userId, token } = req.body;
      if (!userId || !token) return res.status(400).json({ error: 'Missing userId or token' });

      const uid = parseInt(userId);
      if (isNaN(uid)) return res.status(400).json({ error: 'Invalid userId' });

      const expectedToken = generateDashboardToken(uid);
      if (token !== expectedToken) return res.status(401).json({ error: 'Invalid token' });

      let user = await DBService.getUser(uid);
      if (!user) {
        user = await DBService.upsertUser(uid, isOwnerId(uid) ? 1 : 0);
      }
      if (!user) return res.status(500).json({ error: 'User not found' });

      if (isOwnerId(uid) && user.role !== 'owner') {
        await DBService.updateUserRole(uid, 'owner');
        user.role = 'owner';
      }

      res.json({ success: true, userId: uid, role: user.role || 'user' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`POST /api/auth/verify failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/auth/session', authLimiter, async (req: Request, res: Response) => {
    try {
      const { userId, token } = req.body || {};
      if (!userId || !token) return res.status(400).json({ error: 'Missing userId or token' });
      const uid = parseInt(userId);
      if (isNaN(uid)) return res.status(400).json({ error: 'Invalid userId' });
      const expected = generateDashboardToken(uid);
      let authed = token === expected;
      if (!authed && CONFIG.DASHBOARD_SECRET && timingSafeCompare(token, CONFIG.DASHBOARD_SECRET)) {
        if (CONFIG.OWNER_ID == null) return res.status(500).json({ error: 'Owner not configured' });
        authed = true;
      }
      if (!authed) return res.status(401).json({ error: 'Invalid token' });
      const session = await createSession(uid);
      setSessionCookie(res, session.sid);
      res.json({ success: true, userId: uid, expiresAt: session.expiresAt });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`POST /api/auth/session failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    try {
      await destroySession(req);
      clearSessionCookie(res);
      res.json({ success: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`POST /api/auth/logout failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/auth/master', masterLimiter, async (req: Request, res: Response) => {
    try {
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`POST /api/auth/master failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.get('/api/dashboard-info', checkAuth, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.authenticatedUserId as string);
      const user = await DBService.getUser(userId);
      if (!user) return res.status(404).json({ error: 'Not found' });

      const effectiveRole = user.role || (user.is_owner ? 'owner' : 'user');
      const isAdmin = effectiveRole === 'owner' || effectiveRole === 'admin';

      const [stats, scheduled, referrals, workspaces, tickets, apiKeyCount] = await Promise.all([
        DBService.getStats(userId),
        DBService.getUserScheduledPosts(userId),
        DBService.getReferralStats(userId),
        DBService.getUserWorkspaces(userId),
        isAdmin ? DBService.getTickets() : DBService.getUserTickets(userId),
        DBService.getUserApiKeyCount(userId),
      ]);

      res.json({
        user: { id: user.telegram_id, telegram_id: user.telegram_id, username: user.username, first_name: user.first_name, role: effectiveRole, is_owner: !!user.is_owner, is_premium: !!user.is_premium, is_approved: !!user.is_approved, is_active: user.is_active !== 0, target_channel: user.target_channel || null, language: user.language || 'uz', premium_until: user.premium_until || null, referral_code: user.referral_code || null, api_key_count: apiKeyCount },
        stats,
        scheduled,
        referrals,
        workspaces,
        tickets,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`GET /api/dashboard-info failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.get('/api/user/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const u = await DBService.getUser(parseInt(req.authenticatedUserId as string));
      res.json(u ? { ...u, api_key_count: await DBService.getUserApiKeyCount(u.telegram_id) } : { error: 'Not found' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`GET /api/user/:userId failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/auth/web-register', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password || password.length < 6) {
        return res.status(400).json({ error: 'Email and password (6+ chars) required' });
      }
      const normalizedEmail = email.trim().toLowerCase();
      if (await DBService.getWebUserByEmail(normalizedEmail)) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      const telegramId = WEB_ID_START + Date.now();
      const salt = generateSalt();
      const passwordHash = hashPassword(password, salt);
      try {
        await DBService.upsertUser(telegramId, 0, normalizedEmail.split('@')[0], normalizedEmail.split('@')[0]);
        const entry = await DBService.createWebUser({
          email: normalizedEmail,
          password_hash: passwordHash,
          salt,
          telegram_id: telegramId,
          approved: true,
        });
        if (!entry) {
          return res.status(500).json({ error: 'Account creation failed' });
        }
        logger.info(`Web user created: ${normalizedEmail} -> id ${telegramId}`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error(`Web user DB creation failed for ${normalizedEmail}: ${msg}`);
        return res.status(500).json({ error: 'Account creation failed' });
      }
      res.json({ success: true, message: 'Account created. You can now login.' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`POST /api/auth/web-register failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/auth/web-login', authLimiter, async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      const normalizedEmail = email.trim().toLowerCase();
      const entry = await DBService.getWebUserByEmail(normalizedEmail);
      if (!entry) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      if (!entry.approved) return res.status(403).json({ error: 'Account pending approval' });
      const hash = hashPassword(password, entry.salt);
      if (hash !== entry.password_hash) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const token = generateDashboardToken(entry.telegram_id);
      const user = await DBService.getUser(entry.telegram_id);
      res.json({ token, userId: entry.telegram_id, role: user?.role || 'user' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`POST /api/auth/web-login failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.get('/api/auth/web-users', checkAuth, async (req: Request, res: Response) => {
    try {
      const userId = parseInt(req.authenticatedUserId as string);
      const admin = await DBService.getUser(userId);
      const isAdmin = admin && (admin.role === 'owner' || admin.role === 'admin' || admin.is_owner);
      if (!isAdmin && !isOwnerId(userId)) return res.status(403).json({ error: 'Forbidden' });
      res.json(await DBService.getWebUsers());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`GET /api/auth/web-users failed: ${msg}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });
}
