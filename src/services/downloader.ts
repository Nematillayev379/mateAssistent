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
        // -o: output path, -f: format
        await execPromise(`"${ytdlpPath}" -f "best[ext=mp4][filesize<50M]/best[filesize<50M]/best" -o "${filePath}" "${url}"`, { timeout: 60000 });
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
          const { execSync } = require('child_process');
          execSync('yt-dlp --version', { timeout: 5000, stdio: 'ignore' });
          ytdlpCmd = 'yt-dlp';
        } catch {}
      }

      if (ytdlpCmd) {
        await execPromise(`${ytdlpCmd} -f "best" -o "${filePath}" "${url}"`, { timeout: 30000 });
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

    for (const base of instances) {
      // Strategy 1: v10+ Schema (POST /)
      try {
        const res = await axios.post(`${base}/`, {
          url,
          videoQuality: "720",
          filenameStyle: "basic",
          downloadMode: "auto"
        }, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          timeout: 10000
        });

        if (res.data?.url) return res.data.url;
        if (res.data?.status === 'stream') return res.data.url;
        if (res.data?.status === 'picker' && res.data.picker?.length > 0) return res.data.picker[0].url;
      } catch (e: any) {
         // Strategy 2: v7 Schema (POST /api/json)
         try {
           const res = await axios.post(`${base}/api/json`, {
             url,
             vQuality: "720",
             filenamePattern: "basic",
             isAudioOnly: false
           }, {
             headers: {
               'Accept': 'application/json',
               'Content-Type': 'application/json',
               'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
               'Referer': 'https://cobalt.tools/'
             },
             timeout: 8000
           });
           if (res.data?.url) return res.data.url;
           if (res.data?.status === 'stream') return res.data.url;
           if (res.data?.status === 'picker' && res.data.picker?.length > 0) return res.data.picker[0].url;
         } catch (e2) {}
         logger.warn(`Cobalt ${base} failed: ${e.message}`);
      }
    }
    return null;
  },

  /** Clean up temp files older than 1 hour */
  cleanup() {
    try {
      if (!fs.existsSync(TEMP_DIR)) return;
      const files = fs.readdirSync(TEMP_DIR);
      const now = Date.now();
      for (const file of files) {
        const filePath = path.join(TEMP_DIR, file);
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > 3600000) {
          fs.unlinkSync(filePath);
        }
      }
    } catch (e) {}
  }
};

