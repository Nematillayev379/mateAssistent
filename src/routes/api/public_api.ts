import express from 'express';
import rateLimit from 'express-rate-limit';
import { DBService } from '../../services/database';
import { logger } from '../../utils/logger';

async function checkApiKey(req: any, res: any, next: any) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: 'API key required. Use X-API-Key header.' });
  const keys = await DBService.getValidApiKeys();
  const match = keys.find((k: any) => k.key === apiKey);
  if (!match) return res.status(403).json({ error: 'Invalid API key' });
  req.apiUserId = match.user_id;
  next();
}

export function registerPublicApiRoutes(app: express.Application) {
  const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'API rate limit exceeded.' } });
  app.use('/api/v1', publicLimiter);
  app.use('/api/v1', checkApiKey);

  app.get('/api/v1/me', async (req: any, res: any) => {
    const user = await DBService.getUser(req.apiUserId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
      id: user.telegram_id,
      username: user.username,
      role: user.role,
      is_premium: user.is_premium,
      premium_until: user.premium_until,
      language: user.language,
    });
  });

  app.post('/api/v1/publish', async (req: any, res: any) => {
    const { channel, text, parse_mode } = req.body;
    if (!channel || !text) return res.status(400).json({ error: 'channel and text required' });
    try {
      const { bot } = await import('../../services/bot_instance');
      const sent = await bot.sendMessage(channel, text, { parse_mode: parse_mode || 'HTML' });
      await DBService.incrementStat(req.apiUserId, 'total_posts');
      res.json({ success: true, message_id: sent.message_id });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/v1/sources', async (req: any, res: any) => {
    const sources = await DBService.getUserSources(req.apiUserId);
    res.json(sources.map((s: any) => ({ id: s.id, name: s.name, url: s.url, lang: s.lang })));
  });

  app.get('/api/v1/stats', async (req: any, res: any) => {
    const stats = await DBService.getStats(req.apiUserId);
    res.json(stats || { total_posts: 0, total_duplicates: 0 });
  });

  app.get('/api/v1/referral', async (req: any, res: any) => {
    const stats = await DBService.getReferralStats(req.apiUserId);
    const code = await DBService.ensureReferralCode(req.apiUserId);
    const refLink = `https://t.me/${process.env.BOT_USERNAME || 'bot'}?start=ref_${code}`;
    res.json({ link: refLink, ...stats });
  });
}
