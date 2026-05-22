import express from 'express';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { checkAuth } from '../../middleware/auth';

export function registerSettingsRoutes(app: express.Application) {
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
}
