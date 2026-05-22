import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger, sanitizeLogInput } from '../utils/logger';
import { resolveYtDlpCommand } from '../utils/ytdlp';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);
const TEMP_DIR = path.join(os.tmpdir(), 'newsbot_music');
try { if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true }); } catch (e) {}

const MAX_FILE_SIZE = 49 * 1024 * 1024; // 49MB (Telegram limit = 50MB)

export const MusicService = {
  /**
   * Main search function: tries multiple strategies in order
   * 1. yt-dlp (most reliable - supports YouTube, SoundCloud, etc.)
   * 2. Cobalt API (YouTube audio extraction)
   * 3. Direct YouTube search + yt-dlp download
   */
  async searchAndDownload(artist: string, amount: number = 5): Promise<{ title: string, path: string }[]> {
    const results: { title: string, path: string }[] = [];

    // Strategy 1: yt-dlp YouTube search + download (most reliable)
    try {
      logger.info(`MusicService: yt-dlp orqali "${sanitizeLogInput(artist)}" qidirilmoqda...`);
      const ytdlpResults = await this.searchWithYtDlp(artist, amount);
      results.push(...ytdlpResults);
    } catch (e: any) {
      logger.warn(`MusicService: yt-dlp strategy failed: ${e.message}`);
    }
    if (results.length === 0) {
      try {
        logger.info(`MusicService: Cobalt API orqali qidirilmoqda...`);
        const cobaltResults = await this.searchWithCobalt(artist, amount);
        results.push(...cobaltResults);
      } catch (e: any) {
        logger.warn(`MusicService: Cobalt strategy failed: ${e.message}`);
      }
    }

    // Strategy 3: If still not enough, try direct YouTube video IDs + download
    if (results.length === 0) {
      try {
        logger.info(`MusicService: YouTube scrape orqali qidirilmoqda...`);
        const ytResults = await this.searchWithYouTubeScrape(artist, amount);
        results.push(...ytResults);
      } catch (e: any) {
        logger.warn(`MusicService: YouTube scrape strategy failed: ${e.message}`);
      }
    }
    if (results.length === 0) {
      throw new Error("Musiqa topilmadi yoki yuklashda xatolik yuz berdi. Iltimos keyinroq urinib ko'ring.");
    }

    return results.slice(0, amount);
  },

  // Backward compatibility alias
  async searchAndDownloadMuzFm(artist: string, amount: number = 5): Promise<{ title: string, path: string }[]> {
    return this.searchAndDownload(artist, amount);
  },

  /**
   * Strategy 1: Use yt-dlp to search YouTube and download audio directly
   */
  async searchWithYtDlp(artist: string, amount: number): Promise<{ title: string, path: string }[]> {
    const results: { title: string, path: string }[] = [];
    const ytdlpCommand = await this.getYtDlpCommandAsync();
    if (!ytdlpCommand) {
      logger.warn('yt-dlp topilmadi, skip');
      return results;
    }

    try {
      // First search for video URLs
      const safeArtist = artist.replace(/"/g, '').trim();
      const searchQuery = `${safeArtist} music audio`;
      
      const { spawn } = await import('child_process');
      const stdout = await new Promise<string>((resolve, reject) => {
        const proc = spawn(ytdlpCommand.command, [
          ...ytdlpCommand.args,
          `ytsearch${amount * 2}:${searchQuery}`,
          '--flat-playlist',
          '--print', '%(id)s|||%(title)s',
          '--no-warnings'
        ]);
        let data = '';
        proc.stdout.on('data', (d) => data += d.toString());
        proc.on('close', (code) => code === 0 ? resolve(data) : reject(new Error(`yt-dlp exited with code ${code}`)));
        proc.on('error', reject);
      });

      const lines = stdout.trim().split('\n').filter(l => l.includes('|||'));
      const seen = new Set<string>();

      for (const line of lines) {
        if (results.length >= amount) break;
        
        const [videoId, title] = line.split('|||');
        if (!videoId || !title || seen.has(videoId)) continue;
        seen.add(videoId);

        const filePath = path.join(TEMP_DIR, `music_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.m4a`);
        
        try {
          const { execFile } = await import('child_process');
          const execFilePromise = promisify(execFile);
          await execFilePromise(
            ytdlpCommand.command,
            [...ytdlpCommand.args, '-f', 'bestaudio[ext=m4a]/bestaudio/best', '-o', filePath, `https://www.youtube.com/watch?v=${videoId}`, '--no-warnings', '--no-playlist', '--max-filesize', '49M'],
            { timeout: 60000, maxBuffer: 1024 * 1024 }
          );

          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > 0 && stats.size < MAX_FILE_SIZE) {
              results.push({ title: title.trim(), path: filePath });
              logger.info(`✅ Music downloaded: ${sanitizeLogInput(title.trim())} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
            } else {
              try { fs.unlinkSync(filePath); } catch {}
            }
          }
          const altExtensions = ['.webm', '.opus', '.mp3'];
          for (const altExt of altExtensions) {
            const altPath = filePath.replace(/\.[a-zA-Z0-9]+$/, '') + altExt;
            if (fs.existsSync(altPath)) {
              const stats = fs.statSync(altPath);
              if (stats.size > 0 && stats.size < MAX_FILE_SIZE) {
                results.push({ title: title.trim(), path: altPath });
                logger.info(`✅ Music downloaded: ${sanitizeLogInput(title.trim())} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
                break;
              }
            }
          }
        } catch (dlErr: any) {
          logger.warn(`yt-dlp download error for "${sanitizeLogInput(title)}": ${dlErr.message?.slice(0, 100)}`);
          try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
        }
      }
    } catch (e: any) {
      logger.warn(`yt-dlp search error: ${e.message?.slice(0, 200)}`);
    }
    const uniqueResults = new Map<string, { title: string, path: string }>();
    for (const result of results) {
      const normalizedTitle = result.title.toLowerCase().trim();
      if (!uniqueResults.has(normalizedTitle)) {
        uniqueResults.set(normalizedTitle, result);
      }
    }
    return Array.from(uniqueResults.values());
  },

  /**
   * Strategy 2: Search YouTube for video IDs, then use Cobalt API for audio extraction
   */
  async searchWithCobalt(artist: string, amount: number): Promise<{ title: string, path: string }[]> {
    const results: { title: string, path: string }[] = [];
    
    // Get video URLs from YouTube search
    const videos = await this.getYouTubeVideoIds(artist, amount * 2);
    
    const cobaltInstances = [
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

    for (const video of videos) {
      if (results.length >= amount) break;

      for (const base of cobaltInstances) {
        try {
          const res = await axios.post(`${base}/`, {
            url: video.url,
            downloadMode: "audio",
            audioFormat: "mp3",
            audioBitrate: "128"
          }, {
            headers: {
              'Accept': 'application/json',
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
          });

          const audioUrl = res.data?.url;
          if (!audioUrl) continue;

          // Download the audio file
          const filePath = path.join(TEMP_DIR, `music_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`);
          const writer = fs.createWriteStream(filePath);
          const audioRes = await axios.get(audioUrl, { responseType: 'stream', timeout: 30000 });
          audioRes.data.pipe(writer);
          let resolved = false;
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              if (!resolved) {
                resolved = true;
                reject(new Error('Download timeout'));
              }
            }, 45000);
            writer.on('finish', () => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                resolve();
              }
            });
            writer.on('error', (err) => {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                reject(err);
              }
            });
          });

          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > 10000 && stats.size < MAX_FILE_SIZE) {
              results.push({ title: video.title, path: filePath });
              logger.info(`✅ Cobalt download: ${sanitizeLogInput(video.title)} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
              break; // Success, move to next video
            } else {
              try { fs.unlinkSync(filePath); } catch {}
            }
          }
        } catch (e: any) {
          // Try next Cobalt instance
          continue;
        }
      }
    }

    return results;
  },

  /**
   * Strategy 3: YouTube scrape + yt-dlp download for individual videos
   */
  async searchWithYouTubeScrape(artist: string, amount: number): Promise<{ title: string, path: string }[]> {
    const results: { title: string, path: string }[] = [];
    const videos = await this.getYouTubeVideoIds(artist, amount * 2);
    const ytdlpCommand = await this.getYtDlpCommandAsync();

    for (const video of videos) {
      if (results.length >= amount) break;
      
      if (ytdlpCommand) {
        const filePath = path.join(TEMP_DIR, `music_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.m4a`);
        try {
          const { execFile } = await import('child_process');
          const execFilePromise = promisify(execFile);
          await execFilePromise(
            ytdlpCommand.command,
            [...ytdlpCommand.args, '-f', 'bestaudio[ext=m4a]/bestaudio/best', '-o', filePath, video.url, '--no-warnings', '--no-playlist', '--max-filesize', '49M'],
            { timeout: 60000, maxBuffer: 1024 * 1024 }
          );
          
          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > 0 && stats.size < MAX_FILE_SIZE) {
              results.push({ title: video.title, path: filePath });
            } else {
              try { fs.unlinkSync(filePath); } catch {}
            }
          }
        } catch (e: any) {
          try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
        }
      }
    }

    return results;
  },

/**
    * Search YouTube and return video IDs + titles
    * B-48 Fix: Improved parsing with better error handling and fallbacks
    */
  async getYouTubeVideoIds(query: string, limit: number = 10): Promise<{ title: string, url: string, videoId: string }[]> {
    const results: { title: string, url: string, videoId: string }[] = [];

    // Strategy 1: Direct YouTube scraping with multiple user agents
    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' audio music')}&sp=EgIQAQ%253D%253D`;
      const res = await axios.get(searchUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      const body = res.data;
      const jsonMatch = body.match(/(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*({[\s\S]*?});/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;

          if (contents) {
            for (const item of contents) {
              if (results.length >= limit) break;
              const video = item.videoRenderer;
              if (video?.videoId) {
                const title = video.title?.runs?.[0]?.text?.trim() || query;
                if (title) {
                  results.push({
                    title,
                    url: `https://www.youtube.com/watch?v=${video.videoId}`,
                    videoId: video.videoId,
                  });
                }
              }
            }
          }
        } catch (parseErr: any) {
          logger.warn(`YouTube JSON parsing failed: ${parseErr.message}`);
        }
      }
    } catch (e: any) {
      logger.warn(`YouTube search error: ${e.message}`);
    }

    // Strategy 2: Fallback to yt-dlp for video IDs
    if (results.length === 0) {
      const ytdlpResults = await this.searchYouTubeIdsWithYtDlp(query, limit);
      results.push(...ytdlpResults);
    }

    return results;
  },

  async searchYouTubeIdsWithYtDlp(query: string, limit: number): Promise<{ title: string; url: string; videoId: string }[]> {
    const results: { title: string; url: string; videoId: string }[] = [];
    const ytdlpCommand = await resolveYtDlpCommand();
    if (!ytdlpCommand) return results;

    try {
      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFilePromise = promisify(execFile);
      const { stdout } = await execFilePromise(
        ytdlpCommand.command,
        [...ytdlpCommand.args, `ytsearch${limit}:${query}`, '--print', '%(id)s|||%(title)s', '--flat-playlist', '--no-warnings'],
        { timeout: 90000, maxBuffer: 4 * 1024 * 1024 }
      );

      for (const line of stdout.trim().split('\n')) {
        if (results.length >= limit) break;
        if (!line.includes('|||')) continue;
        const [id, title] = line.split('|||');
        if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
          results.push({
            title: (title || query).trim(),
            url: `https://www.youtube.com/watch?v=${id}`,
            videoId: id,
          });
        }
      }
    } catch (e: any) {
      logger.warn(`yt-dlp music search failed: ${e.message}`);
    }

    return results;
  },
  cachedYtDlpCommand: null as { command: string; args: string[] } | null,
  ytDlpChecked: false,
  async getYtDlpCommandAsync(): Promise<{ command: string; args: string[] } | null> {
    return resolveYtDlpCommand();
  },

  getYtDlpPath(): string | null {
    if (this.ytDlpChecked && this.cachedYtDlpCommand) {
      return [this.cachedYtDlpCommand.command, ...this.cachedYtDlpCommand.args].join(' ');
    }
    // Fallback if called synchronously
    return null;
  },

  /**
   * Clean up old temp files
   */
  async cleanup() {
    try {
      if (!fs.existsSync(TEMP_DIR)) return;
      const files = fs.readdirSync(TEMP_DIR);
      const now = Date.now();
      let cleaned = 0;
      for (const file of files) {
        const filePath = path.join(TEMP_DIR, file);
        try {
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > 3600000) {
            fs.unlinkSync(filePath);
            cleaned++;
          }
        } catch {}
      }
      if (cleaned > 0) logger.info(`🧹 MusicService: ${cleaned} temp files cleaned.`);
    } catch {}
  }
};
