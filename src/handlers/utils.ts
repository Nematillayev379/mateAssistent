import fs from 'fs';
import { Response } from 'express';
import { bot } from '../services/bot_instance';
import { logger } from '../utils/logger';

export const serveFileDownload = async (res: Response, filePath: string, filename: string, opts?: { userId?: number; notifyBot?: string }) => {
  if (opts?.notifyBot && opts.userId) {
    try {
      if (opts.notifyBot === 'video') await bot.sendVideo(opts.userId, filePath, { caption: '📥 WebApp orqali yuklandi' });
      else await bot.sendAudio(opts.userId, filePath, { caption: '🎵 WebApp orqali yuklandi' });
    } catch (e: unknown) { logger.warn(`Bot media send skipped for ${opts.userId}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  res.download(filePath, filename, (err: Error | null) => {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e: unknown) { logger.warn(`Cleanup: ${e instanceof Error ? e.message : 'unknown error'}`); }
    if (err && !res.headersSent) res.status(500).json({ error: 'Download failed' });
  });
};
