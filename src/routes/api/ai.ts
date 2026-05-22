import express from 'express';
import rateLimit from 'express-rate-limit';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { logger } from '../../utils/logger';
import { generateSmmPost, generateSmmImage } from '../../services/ai';
import { checkAuth } from '../../middleware/auth';

export function registerAiRoutes(app: express.Application) {
  const aiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: async (req: any) => {
      const userId = req.headers['x-user-id'] || req.query.userId || req.body?.userId;
      if (userId) return (await DBService.isPremiumActive(parseInt(userId as string))) ? 30 : 10;
      return 10;
    },
    message: { error: 'AI request limit exceeded.' }
  });

  app.post('/api/ai/smm', checkAuth, aiLimiter, async (req: any, res: any) => {
    const { prompt, withImage, language } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') return res.status(400).json({ error: 'Prompt bo\'sh bo\'lishi mumkin emas.' });
    try {
      const user = await DBService.getUser(parseInt(req.authenticatedUserId));
      const postLanguage = typeof language === 'string' && language.trim() ? language.trim().slice(0, 8) : user?.language || 'uz';
      const [text, img] = await Promise.all([generateSmmPost(prompt.trim(), postLanguage), withImage === true || withImage === 'true' ? generateSmmImage(prompt.trim()) : Promise.resolve(null)]);
      res.json({ text, imageUrl: img?.imageUrl || null, imageBase64: img?.imageBase64 || null });
    } catch (e: any) { logger.error(`SMM generate error: ${e.message}`); res.status(500).json({ error: 'AI xatolik' }); }
  });

  app.post('/api/ai/post-to-channel', checkAuth, async (req: any, res: any) => {
    const { text, imageUrl, imageBase64 } = req.body;
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Invalid text' });
    try {
      const user = await DBService.getUser(parseInt(req.authenticatedUserId));
      if (!user?.target_channel) return res.status(400).json({ error: 'No channel configured' });
      const caption = `AI Voice News\n\n`;
      const remainder = text.length > 1024 ? text.slice(1024) : '';
      if (imageBase64 && typeof imageBase64 === 'string' && imageBase64.startsWith('data:image')) {
        await bot.sendPhoto(user.target_channel, Buffer.from(imageBase64.split(',')[1], 'base64'), { caption });
      } else if (imageUrl && typeof imageUrl === 'string' && imageUrl.startsWith('http')) {
        await bot.sendPhoto(user.target_channel, imageUrl, { caption });
      } else {
        await bot.sendMessage(user.target_channel, text);
      }
      if (remainder) await bot.sendMessage(user.target_channel, remainder);
      res.json({ success: true });
    } catch (e: any) { logger.error(`SMM post-to-channel error: ${e.message}`); res.status(500).json({ error: 'Telegram send failed' }); }
  });
}
