import axios from 'axios';
import { logger, sanitizeLogInput } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { resolveYtDlpCommand } from '../utils/ytdlp';

const execPromise = promisify(exec);
const TEMP_DIR = path.join(os.tmpdir(), 'newsbot_media');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

export const DownloaderService = {
  /** YouTube: Download video to temp file using yt-dlp */
  async getYouTubeVideo(url: string): Promise<string | null> {
    const filename = `yt_${Date.now()}.mp4`;
    const filePath = path.join(TEMP_DIR, filename);
    
    try {
      const ytdlpCommand = await resolveYtDlpCommand();
      
      if (ytdlpCommand) {
        logger.info(`Downloading YouTube video with yt-dlp: ${sanitizeLogInput(url)}`);
        const { execFile } = await import('child_process');
        const execFilePromise = promisify(execFile);
        await execFilePromise(ytdlpCommand.command, [
          ...ytdlpCommand.args,
          '-f', 'best[ext=mp4][filesize<50M]/best[filesize<50M]/best',
          '-o', filePath,
          url
        ], { timeout: 60000 });
        if (fs.existsSync(filePath)) return filePath;
      }

      // Fallback: Cobalt URL (less reliable but better than nothing)
      return this.getCobaltMedia(url);
    } catch (e: any) {
      logger.error(`yt-dlp download failed: ${e.message}`);
      return this.getCobaltMedia(url);
    }
  },

  /** Instagram: Use multiple fallback strategies */
  async getInstagramVideo(url: string): Promise<string | null> {
    const filename = `ig_${Date.now()}.mp4`;
    const filePath = path.join(TEMP_DIR, filename);

    // Strategy 1: yt-dlp (Most reliable for downloading files)
    try {
      const ytdlpCommand = await resolveYtDlpCommand();

      if (ytdlpCommand) {
        const { execFile } = await import('child_process');
        const execFilePromise = promisify(execFile);
        await execFilePromise(ytdlpCommand.command, [
          ...ytdlpCommand.args,
          '-f', 'best',
          '-o', filePath,
          url
        ], { timeout: 30000 });
        if (fs.existsSync(filePath)) return filePath;
      }
    } catch (e: any) { logger.warn(`Instagram yt-dlp fallback: ${e?.message || 'unknown'}`); }

    // Strategy 2: ddinstagram proxy (Returns URL)
    try {
      const proxyUrl = url.replace(/instagram\.com/i, 'ddinstagram.com');
      const res = await axios.get(proxyUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });
      const match = res.data.match(/property="og:video"\s+content="([^"]+)"/);
      if (match) return match[1];
    } catch { /* ddinstagram proxy is best-effort; continue to Cobalt */ }

    // Strategy 3: Cobalt API
    return this.getCobaltMedia(url);
  },

  /** Cobalt API fallback for any social media */
  async getCobaltMedia(url: string, opts?: { audioOnly?: boolean }): Promise<string | null> {
    const audioOnly = !!opts?.audioOnly;
    const instances = [
      'https://cobaltapi.kittycat.boo',
      'https://dog.kittycat.boo',
      'https://fox.kittycat.boo',
      'https://cobaltapi.squair.xyz',
      'https://api.cobalt.blackcat.sweeux.org',
      'https://api.dl.woof.monster',
      'https://api.qwkuns.me',
      'https://cobaltapi.cjs.nz',
      'https://apicobalt.mgytr.top',
      'https://api.cobalt.liubquanti.click',
      'https://nuko-c.meowing.de',
      'https://sunny.imput.net',
      'https://nachos.imput.net',
      'https://kityune.imput.net',
      'https://blossom.imput.net',
      'https://lime.clxxped.lol',
      'https://melon.clxxped.lol',
      'https://grapefruit.clxxped.lol',
    ];

    const fetchFromInstance = async (base: string) => {
      // 1. Try Cobalt v10 API parameters (POST to base URL)
      try {
        const res = await axios.post(`${base}/`, {
          url,
          vQuality: '720',
          aFormat: 'mp3',
          filenamePattern: 'basic',
          isAudioOnly: audioOnly,
        }, {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Origin: 'https://cobalt.tools',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeout: 15000,
        });

        if (res.data?.url) return res.data.url;
        if (res.data?.status === 'stream' && res.data?.url) return res.data.url;
        if (res.data?.status === 'redirect' && res.data?.url) return res.data.url;
        if (res.data?.status === 'picker' && res.data.picker?.length > 0) {
          return res.data.picker[0].url;
        }
      } catch { logger.warn(`Cobalt v10 API failed`); }

      // 2. Try Cobalt v7/v8 API parameters (POST to base URL)
      try {
        const res = await axios.post(`${base}/`, {
          url,
          videoQuality: '720',
          filenameStyle: 'basic',
          downloadMode: audioOnly ? 'audio' : 'auto',
          audioFormat: 'mp3',
          audioBitrate: '128',
        }, {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Origin: 'https://cobalt.tools',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeout: 15000,
        });

        if (res.data?.url) return res.data.url;
        if (res.data?.status === 'stream' && res.data?.url) return res.data.url;
        if (res.data?.status === 'redirect' && res.data?.url) return res.data.url;
        if (res.data?.status === 'picker' && res.data.picker?.length > 0) {
          return res.data.picker[0].url;
        }
      } catch { logger.warn(`Cobalt v7/v8 API failed`); }

      // 3. Try /api/json endpoint (Some older instances)
      try {
        const res = await axios.post(`${base}/api/json`, {
          url,
          vQuality: '720',
          filenamePattern: 'basic',
          isAudioOnly: audioOnly,
        }, {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          timeout: 15000,
        });
        if (res.data?.url) return res.data.url;
        if (res.data?.status === 'stream' && res.data?.url) return res.data.url;
        if (res.data?.status === 'picker' && res.data.picker?.length > 0) {
          return res.data.picker[0].url;
        }
      } catch { logger.warn(`Cobalt /api/json endpoint failed`); }

      throw new Error('All attempts failed on this instance');
    };

    try {
      const bestUrl = await Promise.any(instances.map(base => fetchFromInstance(base)));
      return bestUrl;
    } catch {
      logger.warn(`All Cobalt instances failed for: ${sanitizeLogInput(url)}`);
      return null;
    }
  },

  /** Clean up temp files older than 1 hour */
  async cleanup() {
    try {
      if (!fs.existsSync(TEMP_DIR)) return;
      const files = await fs.promises.readdir(TEMP_DIR);
      const now = Date.now();
      for (const file of files) {
        const filePath = path.join(TEMP_DIR, file);
        try {
          const stat = await fs.promises.stat(filePath);
          if (now - stat.mtimeMs > 3600000) {
            await fs.promises.unlink(filePath);
          }
        } catch { logger.warn(`Cleanup: failed to remove temp file`); }
      }
    } catch (e: any) { logger.warn(`Cleanup error: ${e?.message || 'unknown'}`); }
  }
};
