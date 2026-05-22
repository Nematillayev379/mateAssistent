import express from 'express';
import { CONFIG, isOwnerId } from '../../config/config';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { checkAuth, timingSafeCompare, verifyTelegramWebAppData } from '../../middleware/auth';

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
}
