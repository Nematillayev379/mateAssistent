import express, { Request, Response } from 'express';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { checkAuth } from '../auth';

export function registerSettingsRoutes(app: express.Application) {
  function normalizeDigestTime(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  app.post('/api/settings/:userId/toggle', checkAuth, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const u = await DBService.getUser(uid);
      if (!u) return res.status(404).json({ error: 'Not found' });
      const next = u.is_active ? 0 : 1;
      await DBService.updateUser(uid, { is_active: next });
      res.json({ success: true, is_active: next });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: msg }); }
  });

  app.get('/api/settings/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const u = await DBService.getUser(parseInt(req.authenticatedUserId as string));
      if (!u) return res.status(404).json({ error: 'Not found' });
      res.json({
        language: u.language,
        target_channel: u.target_channel,
        is_active: u.is_active,
        is_premium: u.is_premium,
        daily_digest: u.daily_digest,
        digest_time: u.digest_time,
        interval_minutes: Math.max(Number(u.interval_minutes) || 15, 1),
        keywords: (await DBService.getKeywords(parseInt(req.authenticatedUserId as string))).join(', '),
      });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: msg }); }
  });

  app.post('/api/settings/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const { language, target_channel, keywords, daily_digest, digest_time, interval_minutes } = req.body;
      const userId = parseInt(req.authenticatedUserId as string);
      const normalizedDigestTime = digest_time !== undefined ? normalizeDigestTime(digest_time) : null;
      if (digest_time !== undefined && !normalizedDigestTime) {
        return res.status(400).json({ error: 'Invalid digest_time format. Use HH:MM.' });
      }
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
      const updates: Record<string, unknown> = {};
      if (language !== undefined) updates.language = language;
      if (target_channel !== undefined) updates.target_channel = target_channel;
      if (daily_digest !== undefined) updates.daily_digest = daily_digest;
      if (normalizedDigestTime !== null) updates.digest_time = normalizedDigestTime;
      if (interval_minutes !== undefined) updates.interval_minutes = Math.max(Math.min(Number(interval_minutes) || 15, 1440), 1);
      const ok = Object.keys(updates).length ? await DBService.updateUser(userId, updates) : true;
      if (!ok) return res.status(500).json({ error: 'Settings update failed' });
      if (keywords !== undefined) await DBService.setKeywords(userId, keywords);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: msg }); }
  });

  app.get('/api/settings/:userId/extended', checkAuth, async (req: Request, res: Response) => {
    try {
      const u = await DBService.getUser(parseInt(req.authenticatedUserId as string));
      if (!u) return res.status(404).json({ error: 'Not found' });
      const keywords = await DBService.getKeywords(parseInt(req.authenticatedUserId as string));
      res.json({ language: u.language, target_channel: u.target_channel, is_active: u.is_active, is_premium: u.is_premium, keywords: keywords.join(', '), daily_digest: u.daily_digest, digest_time: u.digest_time, schedule_times: u.schedule_times, interval_minutes: Math.max(Number(u.interval_minutes) || 15, 1) });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: msg }); }
  });

  app.post('/api/settings/:userId/extended', checkAuth, async (req: Request, res: Response) => {
    try {
      const { language, target_channel, keywords, daily_digest, digest_time, schedule_times, interval_minutes } = req.body;
      const userId = parseInt(req.authenticatedUserId as string);
      const safeInterval = Math.max(Math.min(Number(interval_minutes) || 15, 1440), 1);
      const normalizedDigestTime = digest_time !== undefined ? normalizeDigestTime(digest_time) : null;
      if (digest_time !== undefined && !normalizedDigestTime) {
        return res.status(400).json({ error: 'Invalid digest_time format. Use HH:MM.' });
      }
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
      const updates: Record<string, unknown> = {};
      if (language !== undefined) updates.language = language;
      if (target_channel !== undefined) {
        updates.target_channel = typeof target_channel === 'string' && !target_channel.trim() ? '' : target_channel;
      }
      if (daily_digest !== undefined) updates.daily_digest = daily_digest;
      if (normalizedDigestTime !== null) updates.digest_time = normalizedDigestTime;
      if (schedule_times !== undefined) updates.schedule_times = schedule_times;
      if (interval_minutes !== undefined) updates.interval_minutes = safeInterval;
      const ok = Object.keys(updates).length ? await DBService.updateUser(userId, updates) : true;
      if (!ok) return res.status(500).json({ error: 'Settings update failed' });
      if (keywords !== undefined) await DBService.setKeywords(parseInt(req.authenticatedUserId as string), keywords);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: msg }); }
  });

  app.get('/api/output-channels/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      const u = await DBService.getUser(parseInt(req.authenticatedUserId as string));
      if (!u) return res.status(404).json({ error: 'Not found' });
      res.json({ primary: u.target_channel, extra: u.extra_channels || '', all: DBService.getUserOutputChannels(u) });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: msg }); }
  });

  app.post('/api/output-channels/:userId', checkAuth, async (req: Request, res: Response) => {
    try {
      if (!Array.isArray(req.body.channels)) return res.status(400).json({ error: 'channels array required' });
      await DBService.setExtraChannels(parseInt(req.authenticatedUserId as string), req.body.channels);
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: msg }); }
  });
}
