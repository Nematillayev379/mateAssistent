import express from 'express';
import { DBService } from '../../services/database';
import { TelegramMonitorService, normalizeTelegramChannelId } from '../../services/telegram_monitor';
import { TrendsService } from '../../services/trends';
import { checkAuth } from '../../middleware/auth';

export function registerChannelsRoutes(app: express.Application) {
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

  app.get('/api/trends/uz', checkAuth, async (req: any, res: any) => {
    try { const data = await TrendsService.scanUZTrends(req.query.refresh === '1' || req.query.refresh === 'true'); res.json(data); }
    catch (e: any) {
      const cached = await DBService.getLatestTrendsSnapshot();
      if (cached) return res.json({ topics: cached.topics, summary: cached.summary, at: cached.created_at });
      res.status(500).json({ error: e.message });
    }
  });
}
