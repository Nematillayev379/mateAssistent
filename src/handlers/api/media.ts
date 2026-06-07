import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { DBService } from '../../services/database';
import { bot } from '../../services/bot_instance';
import { logger } from '../../utils/logger';
import { MusicService } from '../../services/music';
import { checkAuth } from '../auth';
import { i18n } from '../../services/i18n';
import { promisify } from 'util';
import { exec } from 'child_process';
import { serveFileDownload } from '../utils';

function getLang(user: Record<string, unknown> | null): string {
  return typeof user?.language === 'string' && user.language.trim() ? user.language.trim() : 'uz';
}

export function registerMediaRoutes(app: express.Application) {
  const mediaAiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: async (req: Request) => {
      const userId = req.headers['x-user-id'] || req.query.userId || req.body?.userId;
      if (userId) return (await DBService.isPremiumActive(parseInt(userId as string))) ? 30 : 10;
      return 10;
    },
    message: { error: i18n.t('ai_request_limit_exceeded', { lng: 'en' }) }
  });

  app.get('/api/music/search', checkAuth, async (req: Request, res: Response) => {
    try { res.json(await MusicService.getYouTubeVideoIds(req.query.q as string, 8)); }
    catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: msg }); }
  });

  app.get('/api/music/download/:id', checkAuth, async (req: Request, res: Response) => {
    const videoId = req.params.id as string;
    const userId = parseInt(req.authenticatedUserId as string);
    const userData = await DBService.getUser(userId);
    const lang = getLang(userData);
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return res.status(400).json({ error: i18n.t('invalid_video_id', { lng: lang }) });
    const webOnly = req.query.web === '1';
    const sendToChannel = req.query.send === '1';

    async function serveFromPath(filePath: string, titleHint?: string) {
      if (sendToChannel) {
        const target = userData?.target_channel;
        if (!target) return res.status(400).json({ success: false, error: i18n.t('target_channel_not_configured', { lng: lang }) });
        await bot.sendAudio(target, filePath);
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
        logger.info(`Music sent to channel ${target} for user ${userId}`);
        return res.json({ success: true, message: i18n.t('music_sent_to_channel', { lng: lang }) });
      }

      const ext = path.extname(filePath) || '.mp3';
      const filename = `${titleHint || `music_${videoId}`}${ext}`;
      await serveFileDownload(res, filePath, filename, { userId, notifyBot: webOnly ? undefined : 'audio' });
    }

    try {
      const { downloadYouTube } = await import('../../services/youtube');
      const filePath = await downloadYouTube(`https://youtube.com/watch?v=${videoId}`, 'audio');
      await serveFromPath(filePath);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`Music download failed for ${videoId}: ${msg}`);

      // Title-based fallback: if direct video extraction fails, try a local audio search by title.
      try {
        const oembed = await import('axios').then((m) =>
          m.default.get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
          })
        );
        const title = String(oembed.data?.title || '').trim();
        if (title) {
          const [fallbackMusic] = await MusicService.searchAndDownload(title, 1);
          if (fallbackMusic?.path) {
            logger.info(`Music title fallback succeeded for ${videoId}: ${title}`);
            await serveFromPath(fallbackMusic.path, fallbackMusic.title || title);
            return;
          }
        }
      } catch (fallbackErr: unknown) {
        logger.warn(`Music title fallback failed for ${videoId}: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
      }

      // Channel delivery fallback: try direct Cobalt URL only when sending to a channel.
      if (sendToChannel) {
        try {
          const target = userData?.target_channel;
          if (!target) return res.status(400).json({ success: false, error: i18n.t('target_channel_not_configured', { lng: lang }) });
          const { DownloaderService } = await import('../../services/downloader');
          const directAudioUrl = await DownloaderService.getCobaltMedia(`https://youtube.com/watch?v=${videoId}`, { audioOnly: true });
          if (directAudioUrl) {
            await bot.sendAudio(target, directAudioUrl);
            logger.info(`Music sent to channel via direct fallback ${target} for user ${userId}`);
            return res.json({ success: true, message: i18n.t('music_sent_to_channel', { lng: lang }) });
          }
        } catch (fallbackErr: unknown) {
          logger.warn(`Music direct fallback failed for ${videoId}: ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`);
        }
      }

      res.status(502).json({ error: e instanceof Error ? e.message : i18n.t('music_download_failed', { lng: lang }) });
    }
  });

  app.post('/api/media/download', checkAuth, async (req: Request, res: Response) => {
    const { url, type } = req.body;
    const userId = parseInt(req.authenticatedUserId as string);
    const userData = await DBService.getUser(userId);
    const lang = getLang(userData);
    const webOnly = req.query.web === '1' || req.body?.delivery === 'web';
    if (!['video', 'audio'].includes(type)) return res.status(400).json({ error: i18n.t('invalid_media_type', { lng: lang }) });
    if (!url || typeof url !== 'string') return res.status(400).json({ error: i18n.t('invalid_media_url', { lng: lang }) });
    try {
      const { downloadYouTube } = await import('../../services/youtube');
      const filePath = await downloadYouTube(url, type);
      const ext = path.extname(filePath) || (type === 'video' ? '.mp4' : '.mp3');
      const filename = `media_${Date.now()}${ext}`;
      await serveFileDownload(res, filePath, filename, { userId, notifyBot: webOnly ? undefined : (type === 'video' ? 'video' : 'audio') });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`Media download failed: ${msg}`);
      res.status(502).json({ error: msg || i18n.t('media_download_failed', { lng: lang }) });
    }
  });

  app.get('/api/debug/ytdlp', checkAuth, async (req: Request, res: Response) => {
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
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: msg }); }
  });

  app.post('/api/ai/voice-news', checkAuth, mediaAiLimiter, async (req: Request, res: Response) => {
    try {
      const uid = parseInt(req.authenticatedUserId as string);
      const { text, title, sendToChannel } = req.body;
      const user = await DBService.getUser(uid);
      const lang = getLang(user);
      if (!user) return res.status(404).json({ error: i18n.t('media_not_found', { lng: lang }) });
      const cleanTitle = typeof title === 'string' ? title.trim() : '';
      const cleanText = typeof text === 'string' ? text.trim() : '';
      if (!cleanTitle && !cleanText) return res.status(400).json({ error: i18n.t('voice_news_empty', { lng: lang }) });
      const { generateAudioSummary, generateTTS } = await import('../../services/ai');
      const script = cleanText || await generateAudioSummary(cleanTitle || 'Yangilik', cleanText || cleanTitle || '', lang);
      const audio = await generateTTS(script, lang);
      if (!audio) return res.status(500).json({ error: i18n.t('voice_generation_failed', { lng: lang }) });
      const caption = `AI Voice News: <b>${cleanTitle || 'AI Ovoz Yangilik'}</b>\n\n${script.slice(0, 500)}`;
      const targets = sendToChannel ? DBService.getUserOutputChannels(user) : [uid];
      let sentCount = 0;
      for (const ch of targets) {
        try {
          await bot.sendAudio(sendToChannel ? ch : uid, audio as Buffer, { caption, parse_mode: 'HTML' }, { filename: 'voice-news-file.mp3', contentType: 'audio/mpeg' });
          sentCount++;
        } catch (e: unknown) { logger.warn(`Voice send failed ${ch}: ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (sentCount === 0) return res.status(502).json({ error: i18n.t('voice_send_failed', { lng: lang }) });
      res.json({ success: true, sent: sentCount, script: script.slice(0, 800) });
    } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); res.status(500).json({ error: msg }); }
  });
}
