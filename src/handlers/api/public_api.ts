import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { DBService } from '../../services/database';
import { logger } from '../../utils/logger';

interface AuthenticatedRequest extends Request {
  apiUserId?: number;
}

async function checkApiKey(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;
    if (!apiKey) return res.status(401).json({ error: 'API key required. Use X-API-Key header.' });
    const keys = await DBService.getValidApiKeys();
    const match = keys.find((k: Record<string, unknown>) => k.key === apiKey);
    if (!match) return res.status(403).json({ error: 'Invalid API key' });
    req.apiUserId = match.user_id as number;
    next();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`checkApiKey error: ${msg}`);
    res.status(500).json({ error: 'Internal error' });
  }
}

export function registerPublicApiRoutes(app: express.Application) {
  const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'API rate limit exceeded.' } });
  app.use('/api/v1', publicLimiter);
  app.use('/api/v1', checkApiKey);

  /**
   * @swagger
   * /api/v1/me:
   *   get:
   *     tags: [Public]
   *     summary: Get current API user profile
   *     description: Returns the profile of the authenticated API user.
   *     operationId: getApiUser
   *     security:
   *       - apiKeyAuth: []
   *     responses:
   *       200:
   *         description: User profile
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 id:
   *                   type: number
   *                 username:
   *                   type: string
   *                 role:
   *                   type: string
   *                 is_premium:
   *                   type: boolean
   *                 premium_until:
   *                   type: string
   *                 language:
   *                   type: string
   *       401:
   *         description: API key required
   *       404:
   *         description: User not found
   */
  app.get('/api/v1/me', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = await DBService.getUser(req.apiUserId as number);
      if (!user) return res.status(404).json({ error: 'User not found' });
      res.json({
        id: user.telegram_id,
        username: user.username,
        role: user.role,
        is_premium: user.is_premium,
        premium_until: user.premium_until,
        language: user.language,
      });
    } catch (e: unknown) { res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (e instanceof Error ? e.message : String(e)) }); }
  });

  /**
   * @swagger
   * /api/v1/publish:
   *   post:
   *     tags: [Public]
   *     summary: Publish message to a channel
   *     description: Sends a text message to an authorized Telegram channel.
   *     operationId: publishMessage
   *     security:
   *       - apiKeyAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [channel, text]
   *             properties:
   *               channel:
   *                 type: string
   *               text:
   *                 type: string
   *               parse_mode:
   *                 type: string
   *     responses:
   *       200:
   *         description: Message sent
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                 message_id:
   *                   type: number
   *       400:
   *         description: channel and text required
   *       401:
   *         description: API key required
   *       403:
   *         description: Not authorized to send to channel
   */
  app.post('/api/v1/publish', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { channel, text, parse_mode } = req.body;
      if (!channel || !text) return res.status(400).json({ error: 'channel and text required' });
      const user = await DBService.getUser(req.apiUserId as number);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const allowedChannels = DBService.getUserOutputChannels(user);
      if (!allowedChannels.includes(channel)) {
        return res.status(403).json({ error: 'Not authorized to send to this channel' });
      }
      const { bot } = await import('../../services/bot_instance');
      const sent = await bot.sendMessage(channel, text, { parse_mode: parse_mode || 'HTML' });
      await DBService.incrementStat(req.apiUserId as number, 'total_posts');
      res.json({ success: true, message_id: sent.message_id });
    } catch (e: unknown) {
      res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (e instanceof Error ? e.message : String(e)) });
    }
  });

  /**
   * @swagger
   * /api/v1/sources:
   *   get:
   *     tags: [Public]
   *     summary: Get user's RSS sources
   *     description: Returns the list of RSS sources configured by the user.
   *     operationId: getSources
   *     security:
   *       - apiKeyAuth: []
   *     responses:
   *       200:
   *         description: List of sources
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   id:
   *                     type: number
   *                   name:
   *                     type: string
   *                   url:
   *                     type: string
   *                   lang:
   *                     type: string
   *       401:
   *         description: API key required
   */
  app.get('/api/v1/sources', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const sources = await DBService.getUserSources(req.apiUserId as number);
      res.json(sources.map((s: Record<string, unknown>) => ({ id: s.id, name: s.name, url: s.url, lang: s.lang })));
    } catch (e: unknown) { res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (e instanceof Error ? e.message : String(e)) }); }
  });

  /**
   * @swagger
   * /api/v1/stats:
   *   get:
   *     tags: [Public]
   *     summary: Get user's posting statistics
   *     description: Returns statistics including total posts and duplicates.
   *     operationId: getStats
   *     security:
   *       - apiKeyAuth: []
   *     responses:
   *       200:
   *         description: Stats data
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 total_posts:
   *                   type: number
   *                 total_duplicates:
   *                   type: number
   *       401:
   *         description: API key required
   */
  app.get('/api/v1/stats', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const stats = await DBService.getStats(req.apiUserId as number);
      res.json(stats || { total_posts: 0, total_duplicates: 0 });
    } catch (e: unknown) { res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (e instanceof Error ? e.message : String(e)) }); }
  });

  /**
   * @swagger
   * /api/v1/referral:
   *   get:
   *     tags: [Public]
   *     summary: Get referral stats and link
   *     description: Returns the user's referral statistics and referral link.
   *     operationId: getReferral
   *     security:
   *       - apiKeyAuth: []
   *     responses:
   *       200:
   *         description: Referral info
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 link:
   *                   type: string
   *       401:
   *         description: API key required
   */
  app.get('/api/v1/referral', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const stats = await DBService.getReferralStats(req.apiUserId as number);
      const code = await DBService.ensureReferralCode(req.apiUserId as number);
      const refLink = `https://t.me/${process.env.BOT_USERNAME || 'bot'}?start=ref_${code}`;
      res.json({ link: refLink, ...stats });
    } catch (e: unknown) { res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (e instanceof Error ? e.message : String(e)) }); }
  });
}
