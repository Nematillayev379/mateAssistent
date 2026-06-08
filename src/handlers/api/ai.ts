import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { logger } from '../../utils/logger';
import { generateSmmPost, generateSmmImage } from '../../services/ai';
import { checkAuth } from '../auth';
import { buildChannelPostMarkup } from '../../services/sender';

export function registerAiRoutes(app: express.Application) {
  const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: async (req: Request) => {
      const userId = req.authenticatedUserId as string;
      if (userId) return (await DBService.isPremiumActive(parseInt(userId))) ? 30 : 10;
      return 10;
    },
    message: { error: 'AI request limit exceeded.' }
  });

  /**
   * @swagger
   * /api/ai/smm:
   *   post:
   *     tags: [AI]
   *     summary: Generate SMM post with AI
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [prompt]
   *             properties:
   *               prompt:
   *                 type: string
   *               withImage:
   *                 type: boolean
   *               language:
   *                 type: string
   *               size:
   *                 type: string
   *                 enum: [short, medium, long]
   *     responses:
   *       200:
   *         description: Generated post
   *       400:
   *         description: Empty prompt
   */
  app.post('/api/ai/smm', checkAuth, aiLimiter, async (req: Request, res: Response) => {
    try {
      const { prompt, withImage, language, size } = req.body;
      if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') return res.status(400).json({ error: 'Prompt bo\'sh bo\'lishi mumkin emas.' });
      const user = await DBService.getUser(parseInt(req.authenticatedUserId as string));
      const postLanguage = typeof language === 'string' && language.trim() ? language.trim().slice(0, 8) : user?.language || 'uz';
      const postSize = size === 'short' || size === 'medium' || size === 'long' ? size : 'medium';
      const [text, img] = await Promise.all([generateSmmPost(prompt.trim(), postLanguage, postSize), withImage === true || withImage === 'true' ? generateSmmImage(prompt.trim()) : Promise.resolve(null)]);
      res.json({ text, imageUrl: img?.imageUrl || null, imageBase64: img?.imageBase64 || null });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`SMM generate error: ${msg}`); res.status(500).json({ error: 'AI xatolik' }); }
  });

  /**
   * @swagger
   * /api/ai/post-to-channel:
   *   post:
   *     tags: [AI]
   *     summary: Post AI-generated content to channel
   *     security:
   *       - bearerAuth: []
   *       - sessionAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [text]
   *             properties:
   *               text:
   *                 type: string
   *               imageUrl:
   *                 type: string
   *               imageBase64:
   *                 type: string
   *               prompt:
   *                 type: string
   *     responses:
   *       200:
   *         description: Post sent
   *       400:
   *         description: No channel configured
   */
  app.post('/api/ai/post-to-channel', checkAuth, async (req: Request, res: Response) => {
    try {
      const { text, imageUrl, imageBase64, prompt } = req.body;
      if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Invalid text' });
      const user = await DBService.getUser(parseInt(req.authenticatedUserId as string));
      if (!user?.target_channel) return res.status(400).json({ error: 'No channel configured' });
      const title = typeof prompt === 'string' && prompt.trim() ? prompt.trim().slice(0, 120) : 'AI Studio Post';
      if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.startsWith('data:image')) {
        const caption = await buildChannelPostMarkup({ title, content: text, source: 'AI Studio', url: process.env.PUBLIC_URL || '' }, { maxLength: 1024 });
        await bot.sendPhoto(user.target_channel, Buffer.from(imageBase64.split(',')[1], 'base64'), { caption, parse_mode: 'HTML' });
      } else if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
        const caption = await buildChannelPostMarkup({ title, content: text, source: 'AI Studio', url: process.env.PUBLIC_URL || '' }, { maxLength: 1024 });
        await bot.sendPhoto(user.target_channel, imageUrl, { caption, parse_mode: 'HTML' });
      } else {
        const message = await buildChannelPostMarkup({ title, content: text, source: 'AI Studio', url: process.env.PUBLIC_URL || '' });
        await bot.sendMessage(user.target_channel, message, { parse_mode: 'HTML' });
      }
      res.json({ success: true });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.error(`SMM post-to-channel error: ${msg}`); res.status(500).json({ error: 'Telegram send failed' }); }
  });
}
