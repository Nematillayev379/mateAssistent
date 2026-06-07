import crypto from 'crypto';
import { CONFIG, isOwnerId } from '../config/config';
import { DBService } from '../services/database';
import { generateDashboardToken } from '../services/bot_instance';
import { logger } from '../utils/logger';
import { readSessionUserId } from './session';

export const extractUserId = async (req: any): Promise<string> => {
  const fromSession = await readSessionUserId(req);
  if (fromSession) return fromSession;
  return String(
    req.headers['x-user-id'] ||
    req.params.userId ||
    req.query.userId ||
    req.query.user ||
    req.body?.userId ||
    ''
  );
};

export const timingSafeCompare = (str1: string, str2: string): boolean => {
  if (!str1 || !str2) return false;
  const b1 = Buffer.from(str1, 'utf8');
  const b2 = Buffer.from(str2, 'utf8');
  if (b1.length !== b2.length) return false;
  return crypto.timingSafeEqual(b1, b2);
};

export const checkAuth = async (req: any, res: any, next: any) => {
  try {
    const sessionUserId = await readSessionUserId(req);
    if (sessionUserId) {
      req.authenticatedUserId = sessionUserId;
      if (isOwnerId(parseInt(sessionUserId))) {
        DBService.getUser(parseInt(sessionUserId)).then(async (user: any) => {
          if (user && user.role !== 'owner') {
            await DBService.updateUserRole(parseInt(sessionUserId), 'owner');
          }
        }).catch((e: any) => logger.warn(`Owner role sync failed: ${e.message}`));
      }
      return next();
    }

    const token = req.headers['x-bot-token'] || req.query.token || (req.headers.authorization?.split(' ')[1] ?? '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    if (token && CONFIG.DASHBOARD_SECRET && timingSafeCompare(token, CONFIG.DASHBOARD_SECRET)) {
      if (CONFIG.OWNER_ID == null) return res.status(500).json({ error: 'Owner ID not configured' });
      req.authenticatedUserId = String(CONFIG.OWNER_ID);
      return next();
    }

    const userId = await extractUserId(req);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (token !== generateDashboardToken(userId)) return res.status(401).json({ error: 'Invalid token for this user' });

    req.authenticatedUserId = userId;
    if (isOwnerId(parseInt(userId))) {
      DBService.getUser(parseInt(userId)).then(async (user: any) => {
        if (user && user.role !== 'owner') {
          await DBService.updateUserRole(parseInt(userId), 'owner');
        }
      }).catch((e: any) => logger.warn(`Owner role sync failed: ${e.message}`));
    }

    next();
  } catch (e: any) {
    logger.error(`checkAuth error: ${e.message}`);
    res.status(500).json({ error: 'Authentication error' });
  }
};

export const checkAdmin = async (req: any, res: any, next: any) => {
  const sessionUserId = await readSessionUserId(req);
  if (sessionUserId) {
    const sessionUid = parseInt(sessionUserId);
    const user = await DBService.getUser(sessionUid);
    const isAdmin = user && (user.role === 'owner' || user.role === 'admin' || user.is_owner === 1 || isOwnerId(sessionUid));
    if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access only' });
    req.authenticatedUserId = sessionUserId;
    return next();
  }

  const token = req.headers['x-bot-token'] || req.query.token || (req.headers.authorization?.split(' ')[1] ?? '');
  const adminId = await extractUserId(req);

  if (token && CONFIG.DASHBOARD_SECRET && timingSafeCompare(token, CONFIG.DASHBOARD_SECRET)) {
    if (CONFIG.OWNER_ID == null) return res.status(500).json({ error: 'Owner ID not configured' });
    req.authenticatedUserId = String(CONFIG.OWNER_ID);
    return next();
  }

  if (!adminId || !token) return res.status(401).json({ error: 'Unauthorized' });
  if (token !== generateDashboardToken(adminId)) return res.status(401).json({ error: 'Invalid admin token' });

  const adminUid = parseInt(adminId);
  const user = await DBService.getUser(adminUid);
  const isAdmin = user && (user.role === 'owner' || user.role === 'admin' || user.is_owner === 1 || isOwnerId(adminUid));
  if (!isAdmin) return res.status(403).json({ error: 'Forbidden: Admin access only' });
  req.authenticatedUserId = adminId;
  next();
};

export const verifyTelegramWebAppData = (telegramInitData: string): any => {
  try {
    const initData = new URLSearchParams(telegramInitData);
    const hash = initData.get('hash');
    if (!hash) { logger.warn('Telegram auth failed: hash is missing'); return null; }

    const authDate = initData.get('auth_date');
    if (!authDate) { logger.warn('Telegram auth failed: auth_date is missing'); return null; }
    const authTs = parseInt(authDate, 10);
    if (isNaN(authTs)) { logger.warn(`Telegram auth failed: auth_date "${authDate}" is not a number`); return null; }

    const timeDiff = Math.abs(Date.now() / 1000 - authTs);
    if (timeDiff > 86400) { logger.warn(`Telegram auth failed: auth_date age ${timeDiff}s exceeds 24 hours limit`); return null; }

    initData.delete('hash');
    const keys = Array.from(initData.keys()).sort();
    const dataCheckString = keys.map(key => `${key}=${initData.get(key)}`).join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update((CONFIG.TELEGRAM_TOKEN || '').trim()).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

    if (calculatedHash === hash) {
      const userStr = initData.get('user');
      return userStr ? JSON.parse(userStr) : null;
    }
    logger.warn(`Telegram auth failed: hash mismatch`);
    return null;
  } catch (e: any) {
    logger.error(`Telegram auth exception: ${e.message}`);
    return null;
  }
};
