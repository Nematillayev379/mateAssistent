import axios from 'axios';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);
const TEMP_DIR = path.join(os.tmpdir(), 'newsbot_media');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

export const DownloaderService = {
  /** YouTube: Download video to temp file using yt-dlp */
  async getYouTubeVideo(url: string): Promise<string | null> {
    const filename = `yt_${Date.now()}.mp4`;
    const filePath = path.join(TEMP_DIR, filename);
    
    try {
      const ytdlpName = os.platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
      const ytdlpPath = path.join(process.cwd(), ytdlpName);
      
      if (fs.existsSync(ytdlpPath)) {
        logger.info(`Downloading YouTube video with yt-dlp: ${url}`);
        // BUG-047 Fix: Use execFile to avoid hanging processes when shell ignores SIGTERM on timeout
        const { execFile } = await import('child_process');
        const execFilePromise = promisify(execFile);
        await execFilePromise(ytdlpPath, [
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
      const ytdlpName = os.platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
      const ytdlpPath = path.join(process.cwd(), ytdlpName);
      let ytdlpCmd: string | null = null;

      if (fs.existsSync(ytdlpPath)) {
        ytdlpCmd = `"${ytdlpPath}"`;
      } else {
        // Check system PATH
        try {
          const { execFile } = await import('child_process');
          const execFilePromise = promisify(execFile);
          await execFilePromise('yt-dlp', ['--version'], { timeout: 5000 });
          ytdlpCmd = 'yt-dlp';
        } catch {}
      }

      if (ytdlpCmd) {
        const { execFile } = await import('child_process');
        const execFilePromise = promisify(execFile);
        await execFilePromise(ytdlpCmd, [
          '-f', 'best',
          '-o', filePath,
          url
        ], { timeout: 30000 });
        if (fs.existsSync(filePath)) return filePath;
      }
    } catch (e) {}

    // Strategy 2: ddinstagram proxy (Returns URL)
    try {
      const proxyUrl = url.replace(/instagram\.com/i, 'ddinstagram.com');
      const res = await axios.get(proxyUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });
      const match = res.data.match(/property="og:video"\s+content="([^"]+)"/);
      if (match) return match[1];
    } catch (e: any) {}

    // Strategy 3: Cobalt API
    return this.getCobaltMedia(url);
  },

  /** Cobalt API fallback for any social media */
  async getCobaltMedia(url: string): Promise<string | null> {
    const instances = [
      'https://api.cobalt.tools',
      'https://cobalt.liubquanti.click',
      'https://cobalt.canine.tools',
      'https://cobalt.meowing.de',
      'https://cobalt.kittycat.boo',
      'https://dl.woof.monster',
    ];

    // BUG-049 Fix: Use Promise.any to fetch from multiple Cobalt instances concurrently
    const fetchFromInstance = async (base: string) => {
      try {
        const res = await axios.post(`${base}/`, {
          url,
          videoQuality: "720",
          filenameStyle: "basic",
          downloadMode: "auto"
        }, {
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          timeout: 6000
        });

        if (res.data?.url) return res.data.url;
        if (res.data?.status === 'stream') return res.data.url;
        if (res.data?.status === 'picker' && res.data.picker?.length > 0) return res.data.picker[0].url;
        throw new Error('No URL in response');
      } catch {
        const res = await axios.post(`${base}/api/json`, {
          url, vQuality: "720", filenamePattern: "basic", isAudioOnly: false
        }, {
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          timeout: 5000
        });
        if (res.data?.url) return res.data.url;
        if (res.data?.status === 'stream') return res.data.url;
        if (res.data?.status === 'picker' && res.data.picker?.length > 0) return res.data.picker[0].url;
        throw new Error('No URL in response');
      }
    };

    try {
      const bestUrl = await Promise.any(instances.map(base => fetchFromInstance(base)));
      return bestUrl;
    } catch {
      logger.warn(`All Cobalt instances failed for: ${url}`);
      return null;
    }
  },

  /** Clean up temp files older than 1 hour */
  // BUG-048 Fix: Use async operations to prevent blocking the Node.js event loop
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
        } catch {}
      }
    } catch (e) {}
  }
};

