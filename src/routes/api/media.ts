import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { CONFIG } from '../../config/config';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { logger } from '../../utils/logger';
import { MusicService } from '../../services/music';
import { checkAuth } from '../../middleware/auth';
import { promisify } from 'util';
import { exec } from 'child_process';
import { serveFileDownload } from '../utils';

export function registerMediaRoutes(app: express.Application) {
  const mediaAiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: async (req: any) => {
      const userId = req.headers['x-user-id'] || req.query.userId || req.body?.userId;
      if (userId) return (await DBService.isPremiumActive(parseInt(userId as string))) ? 30 : 10;
      return 10;
    },
    message: { error: 'AI request limit exceeded.' }
  });

  app.get('/api/music/search', checkAuth, async (req, res) => res.json(await MusicService.getYouTubeVideoIds(req.query.q as string, 8)));

  app.get('/api/music/download/:id', checkAuth, async (req: any, res: any) => {
    const videoId = req.params.id;
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return res.status(400).json({ error: 'Invalid video ID' });
    const userId = parseInt(req.authenticatedUserId);
    const webOnly = req.query.web === '1';
    const sendToChannel = req.query.send === '1';
    try {
      const { downloadYouTube } = await import('../../services/youtube');
      const filePath = await downloadYouTube(`https://youtube.com/watch?v=${videoId}`, 'audio');
      const ext = path.extname(filePath) || '.mp3';
      const filename = `music_${videoId}${ext}`;
      if (sendToChannel) {
        const userData = await DBService.getUser(userId);
        const target = userData?.target_channel;
        if (!target) return res.status(400).json({ success: false, error: 'Target channel not configured' });
        await bot.sendAudio(target, filePath);
        logger.info(`Music sent to channel ${target} for user ${userId}`);
        return res.json({ success: true, message: 'Musiqa kanalga yuborildi!' });
      }
      await serveFileDownload(res, filePath, filename, { userId, notifyBot: webOnly ? undefined : 'audio' });
    } catch (e: any) {
      logger.warn(`Music download failed for ${videoId}: ${e.message}`);
      if (sendToChannel) {
        try {
          const userData = await DBService.getUser(userId);
          const target = userData?.target_channel;
          if (!target) return res.status(400).json({ success: false, error: 'Target channel not configured' });
          const { DownloaderService } = await import('../../services/downloader');
          const directAudioUrl = await DownloaderService.getCobaltMedia(`https://youtube.com/watch?v=${videoId}`, { audioOnly: true });
          if (directAudioUrl) {
            await bot.sendAudio(target, directAudioUrl);
            logger.info(`Music sent to channel via direct fallback ${target} for user ${userId}`);
            return res.json({ success: true, message: 'Musiqa kanalga yuborildi!' });
          }
        } catch (fallbackErr: any) {
          logger.warn(`Music direct fallback failed for ${videoId}: ${fallbackErr.message}`);
        }
      }
      res.status(502).json({ error: e.message || 'Musiqa yuklab bo‘lmadi' });
    }
  });

  app.post('/api/media/download', checkAuth, async (req: any, res: any) => {
    const { url, type } = req.body;
    const userId = parseInt(req.authenticatedUserId);
    const webOnly = req.query.web === '1' || req.body?.delivery === 'web';
    if (!['video', 'audio'].includes(type)) return res.status(400).json({ error: 'Invalid media type' });
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Invalid URL' });
    try {
      const { downloadYouTube } = await import('../../services/youtube');
      const filePath = await downloadYouTube(url, type);
      const ext = path.extname(filePath) || (type === 'video' ? '.mp4' : '.mp3');
      const filename = `media_${Date.now()}${ext}`;
      await serveFileDownload(res, filePath, filename, { userId, notifyBot: webOnly ? undefined : (type === 'video' ? 'video' : 'audio') });
    } catch (e: any) {
      logger.warn(`Media download failed: ${e.message}`);
      res.status(502).json({ error: e.message || 'Media yuklab bo‘lmadi' });
    }
  });

  app.get('/api/debug/ytdlp', checkAuth, async (req: any, res: any) => {
    try {
      const { resolveYtDlpPath } = await import('../../utils/ytdlp');
      const ytdlpPath = await resolveYtDlpPath();
      res.json({
        ytdlpPath,
        fsExists: ytdlpPath ? fs.existsSync(ytdlpPath) : false,
        size: ytdlpPath && fs.existsSync(ytdlpPath) ? fs.statSync(ytdlpPath).size : 0,
        version: ytdlpPath ? (await promisify(exec)((ytdlpPath.includes(' ') || ytdlpPath.includes('\\') ? `"${ytdlpPath}"` : ytdlpPath) + ' --version', { timeout: 5000 }).then(r => r.stdout.trim()).catch(() => 'error')) : 'not found',
        cwd: process.cwd(),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/ai/voice-news', checkAuth, mediaAiLimiter, async (req: any, res: any) => {
    const uid = parseInt(req.authenticatedUserId);
    const { text, title, sendToChannel } = req.body;
    const user = await DBService.getUser(uid);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const cleanTitle = typeof title === 'string' ? title.trim() : '';
    const cleanText = typeof text === 'string' ? text.trim() : '';
    if (!cleanTitle && !cleanText) return res.status(400).json({ error: 'Sarlavha yoki matn kiriting' });
    const lang = typeof user.language === 'string' && user.language.trim() ? user.language.trim() : 'uz';
    const { generateAudioSummary, generateTTS } = await import('../../services/ai');
    const script = cleanText || await generateAudioSummary(cleanTitle || 'Yangilik', cleanText || cleanTitle || '', lang);
    const audio = await generateTTS(script, lang);
    if (!audio) return res.status(500).json({ error: 'Ovoz generatsiyasi muvaffaqiyatsiz' });
    const caption = `AI Voice News: <b>${cleanTitle || 'AI Ovoz Yangilik'}</b>\n\n${script.slice(0, 500)}`;
    const targets = sendToChannel ? DBService.getUserOutputChannels(user) : [uid];
    let sentCount = 0;
    for (const ch of targets) {
      try {
        await bot.sendAudio(sendToChannel ? ch : uid, audio as any, { caption, parse_mode: 'HTML' }, { filename: 'voice-news-file.mp3', contentType: 'audio/mpeg' } as any);
        sentCount++;
      } catch (e: any) { logger.warn(`Voice send failed ${ch}: ${e.message}`); }
    }
    if (sentCount === 0) return res.status(502).json({ error: 'Ovoz yuborilmadi' });
    res.json({ success: true, sent: sentCount, script: script.slice(0, 800) });
  });
}
