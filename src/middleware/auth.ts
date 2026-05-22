import crypto from 'crypto';
import { CONFIG, isOwnerId } from '../config/config';
import { DBService } from '../services/database';
import { generateDashboardToken } from '../services/bot_instance';
import { logger } from '../utils/logger';

export const extractUserId = (req: any): string => {
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
  const h1 = crypto.createHmac('sha256', 'timing-safe-salt').update(str1).digest();
  const h2 = crypto.createHmac('sha256', 'timing-safe-salt').update(str2).digest();
  return crypto.timingSafeEqual(h1, h2);
};

export const checkAuth = (req: any, res: any, next: any) => {
  const token = req.headers['x-bot-token'] || req.query.token || (req.headers.authorization?.split(' ')[1] ?? '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  if (token && CONFIG.DASHBOARD_SECRET && timingSafeCompare(token, CONFIG.DASHBOARD_SECRET)) {
    if (CONFIG.OWNER_ID == null) return res.status(500).json({ error: 'Owner ID not configured' });
    req.authenticatedUserId = String(CONFIG.OWNER_ID);
    return next();
  }

  const userId = extractUserId(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (token !== generateDashboardToken(userId)) return res.status(401).json({ error: 'Invalid token for this user' });

  req.authenticatedUserId = userId;
  if (isOwnerId(parseInt(userId))) {
    DBService.getUser(parseInt(userId)).then((user: any) => {
      if (user && user.role !== 'owner') DBService.updateUserRole(parseInt(userId), 'owner');
    }).catch((e: any) => logger.warn(`Owner role sync failed: ${e.message}`));
  }

  next();
};

export const checkAdmin = async (req: any, res: any, next: any) => {
  const token = req.headers['x-bot-token'] || req.query.token || (req.headers.authorization?.split(' ')[1] ?? '');
  const adminId = extractUserId(req);

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
    if (timeDiff > 86400 * 30) { logger.warn(`Telegram auth failed: auth_date age ${timeDiff}s exceeds 30 days limit`); return null; }

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
