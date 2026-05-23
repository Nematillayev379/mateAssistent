import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CONFIG, isOwnerId } from '../../config/config';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { checkAuth, timingSafeCompare, verifyTelegramWebAppData } from '../../middleware/auth';
import { generateDashboardToken } from '../../services/bot_instance';
import { logger } from '../../utils/logger';

const WEB_USERS_FILE = path.join(process.cwd(), 'data', 'web_users.json');

function loadWebUsers(): any[] {
  try {
    if (fs.existsSync(WEB_USERS_FILE)) {
      return JSON.parse(fs.readFileSync(WEB_USERS_FILE, 'utf-8'));
    }
  } catch (e) { logger.warn(`web_users.json load error: ${(e as Error).message}`); }
  return [];
}

function saveWebUsers(users: any[]) {
  const dir = path.dirname(WEB_USERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(WEB_USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** Reserve IDs >= 900000000 for web-only accounts */
const WEB_ID_START = 900_000_000;

function nextWebUserId(users: any[]): number {
  const existing = users.map(u => u.telegram_id).filter((id: number) => id >= WEB_ID_START);
  return existing.length > 0 ? Math.max(...existing) + 1 : WEB_ID_START;
}

export function registerAuthRoutes(app: express.Application) {
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
    const token = require('../../services/bot_instance').generateDashboardToken(tgUser.id);
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

  app.post('/api/auth/web-register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password || password.length < 6) {
      return res.status(400).json({ error: 'Email and password (6+ chars) required' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const users = loadWebUsers();
    if (users.find(u => u.email === normalizedEmail)) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const telegramId = nextWebUserId(users);
    const salt = generateSalt();
    const passwordHash = hashPassword(password, salt);
    const entry = { email: normalizedEmail, passwordHash, salt, telegram_id: telegramId, approved: true, created: new Date().toISOString() };
    users.push(entry);
    saveWebUsers(users);
    try {
      await DBService.upsertUser(telegramId, 0, normalizedEmail.split('@')[0], normalizedEmail.split('@')[0]);
      logger.info(`Web user created: ${normalizedEmail} -> id ${telegramId}`);
    } catch (e) {
      logger.error(`Web user DB creation failed for ${normalizedEmail}: ${(e as Error).message}`);
    }
    res.json({ success: true, message: 'Account created. You can now login.' });
  });

  app.post('/api/auth/web-login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const normalizedEmail = email.trim().toLowerCase();
    const users = loadWebUsers();
    const entry = users.find(u => u.email === normalizedEmail);
    if (!entry) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!entry.approved) return res.status(403).json({ error: 'Account pending approval' });
    const hash = hashPassword(password, entry.salt);
    if (hash !== entry.passwordHash) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = generateDashboardToken(entry.telegram_id);
    const user = await DBService.getUser(entry.telegram_id);
    res.json({ token, userId: entry.telegram_id, role: user?.role || 'user' });
  });

  app.get('/api/auth/web-users', checkAuth, async (req: any, res: any) => {
    const userId = parseInt(req.authenticatedUserId);
    const admin = await DBService.getUser(userId);
    const isAdmin = admin && (admin.role === 'owner' || admin.role === 'admin' || admin.is_owner);
    if (!isAdmin && !isOwnerId(userId)) return res.status(403).json({ error: 'Forbidden' });
    const users = loadWebUsers();
    res.json(users.map(u => ({ email: u.email, telegram_id: u.telegram_id, approved: u.approved, created: u.created })));
  });
}
