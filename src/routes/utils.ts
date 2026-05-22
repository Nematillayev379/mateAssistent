import fs from 'fs';
import { bot } from '../services/bot_instance';
import { logger } from '../utils/logger';

export const serveFileDownload = async (res: any, filePath: string, filename: string, opts?: { userId?: number; notifyBot?: string }) => {
  if (opts?.notifyBot && opts.userId) {
    try {
      if (opts.notifyBot === 'video') await bot.sendVideo(opts.userId, filePath, { caption: '📥 WebApp orqali yuklandi' });
      else await bot.sendAudio(opts.userId, filePath, { caption: '🎵 WebApp orqali yuklandi' });
    } catch (e: any) { logger.warn(`Bot media send skipped for ${opts.userId}: ${e.message}`); }
  }
  res.download(filePath, filename, (err: any) => {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    if (err && !res.headersSent) res.status(500).json({ error: 'Download failed' });
  });
};
