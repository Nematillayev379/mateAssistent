import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);
const TEMP_DIR = path.join(os.tmpdir(), 'newsbot_music');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

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
      logger.info(`MusicService: yt-dlp orqali "${artist}" qidirilmoqda...`);
      const ytdlpResults = await this.searchWithYtDlp(artist, amount);
      results.push(...ytdlpResults);
    } catch (e: any) {
      logger.warn(`MusicService: yt-dlp strategy failed: ${e.message}`);
    }

    // Strategy 2: If not enough results, try Cobalt API with YouTube search
    if (results.length < amount) {
      try {
        logger.info(`MusicService: Cobalt API orqali qidirilmoqda...`);
        const remaining = amount - results.length;
        const cobaltResults = await this.searchWithCobalt(artist, remaining);
        results.push(...cobaltResults);
      } catch (e: any) {
        logger.warn(`MusicService: Cobalt strategy failed: ${e.message}`);
      }
    }

    // Strategy 3: If still not enough, try direct YouTube video IDs + download
    if (results.length < amount) {
      try {
        logger.info(`MusicService: YouTube scrape orqali qidirilmoqda...`);
        const remaining = amount - results.length;
        const ytResults = await this.searchWithYouTubeScrape(artist, remaining);
        results.push(...ytResults);
      } catch (e: any) {
        logger.warn(`MusicService: YouTube scrape strategy failed: ${e.message}`);
      }
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
    const ytdlpPath = this.getYtDlpPath();
    if (!ytdlpPath) {
      logger.warn('yt-dlp topilmadi, skip');
      return results;
    }

    try {
      // First search for video URLs
      const safeArtist = artist.replace(/"/g, '').trim();
      const searchQuery = `${safeArtist} music audio`;
      
      const { spawn } = await import('child_process');
      const stdout = await new Promise<string>((resolve, reject) => {
        const proc = spawn(ytdlpPath, [
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
          await execPromise(
            `"${ytdlpPath}" -f "bestaudio[ext=m4a]" -o "${filePath}" "https://www.youtube.com/watch?v=${videoId}" --no-warnings --no-playlist --max-filesize 49M`,
            { timeout: 60000 }
          );

          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > 0 && stats.size < MAX_FILE_SIZE) {
              results.push({ title: title.trim(), path: filePath });
              logger.info(`✅ Music downloaded: ${title.trim()} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
            } else {
              try { fs.unlinkSync(filePath); } catch {}
            }
          }
          // yt-dlp may produce different extension (e.g. .webm, .opus)
          const altExtensions = ['.webm', '.opus', '.mp3'];
          for (const altExt of altExtensions) {
            const altPath = filePath.replace(/\.[a-zA-Z0-9]+$/, '') + altExt;
            if (!fs.existsSync(filePath) && fs.existsSync(altPath)) {
              const stats = fs.statSync(altPath);
              if (stats.size > 0 && stats.size < MAX_FILE_SIZE) {
                results.push({ title: title.trim(), path: altPath });
                logger.info(`✅ Music downloaded: ${title.trim()} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
                break;
              }
            }
          }
        } catch (dlErr: any) {
          logger.warn(`yt-dlp download error for "${title}": ${dlErr.message?.slice(0, 100)}`);
          try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
        }
      }
    } catch (e: any) {
      logger.warn(`yt-dlp search error: ${e.message?.slice(0, 200)}`);
    }

    return results;
  },

  /**
   * Strategy 2: Search YouTube for video IDs, then use Cobalt API for audio extraction
   */
  async searchWithCobalt(artist: string, amount: number): Promise<{ title: string, path: string }[]> {
    const results: { title: string, path: string }[] = [];
    
    // Get video URLs from YouTube search
    const videos = await this.getYouTubeVideoIds(artist, amount * 2);
    
    const cobaltInstances = [
      'https://api.cobalt.tools',
      'https://cobalt.canine.tools', 
      'https://cobalt.meowing.de',
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

          await new Promise<void>((resolve, reject) => {
            writer.on('finish', () => resolve());
            writer.on('error', reject);
            // Safety timeout
            setTimeout(() => reject(new Error('Download timeout')), 45000);
          });

          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > 10000 && stats.size < MAX_FILE_SIZE) {
              results.push({ title: video.title, path: filePath });
              logger.info(`✅ Cobalt download: ${video.title} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
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
    const ytdlpPath = this.getYtDlpPath();

    for (const video of videos) {
      if (results.length >= amount) break;
      
      if (ytdlpPath) {
        const filePath = path.join(TEMP_DIR, `music_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.m4a`);
        try {
          await execPromise(
            `"${ytdlpPath}" -f "bestaudio[ext=m4a]" -o "${filePath}" "${video.url}" --no-warnings --no-playlist --max-filesize 49M`,
            { timeout: 60000 }
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
   */
  async getYouTubeVideoIds(query: string, limit: number = 10): Promise<{ title: string, url: string }[]> {
    const results: { title: string, url: string }[] = [];

    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' audio music')}&sp=EgIQAQ%253D%253D`;
      const res = await axios.get(searchUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      const body = res.data;
      
      // Try JSON extraction
      const jsonMatch = body.match(/var ytInitialData = ({[\s\S]*?});<\/script>/);
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;

          if (contents) {
            for (const item of contents) {
              if (results.length >= limit) break;
              const video = item.videoRenderer;
              if (video?.videoId) {
                results.push({
                  title: video.title?.runs?.[0]?.text || query,
                  url: `https://www.youtube.com/watch?v=${video.videoId}`
                });
              }
            }
          }
        } catch {}
      }

      // Fallback: regex
      if (results.length === 0) {
        const regex = /\/watch\?v=([a-zA-Z0-9_-]{11})/g;
        let match;
        const seen = new Set<string>();
        while ((match = regex.exec(body)) !== null && results.length < limit) {
          const videoId = match[1];
          if (!seen.has(videoId)) {
            seen.add(videoId);
            results.push({
              title: `${query}`,
              url: `https://www.youtube.com/watch?v=${videoId}`
            });
          }
        }
      }
    } catch (e: any) {
      logger.warn(`YouTube search error: ${e.message}`);
    }

    return results;
  },

  /**
   * Get yt-dlp path (check multiple locations)
   */
  getYtDlpPath(): string | null {
    const possiblePaths = [
      path.join(process.cwd(), 'yt-dlp.exe'),
      path.join(process.cwd(), 'yt-dlp'),
      'yt-dlp', // System PATH
    ];

    logger.info(`🔍 MusicService: Checking for yt-dlp in: ${JSON.stringify(possiblePaths)}`);

    for (const p of possiblePaths) {
      if (p === 'yt-dlp') {
        // Check if available in PATH
        try {
          execSync('yt-dlp --version', { timeout: 5000, stdio: 'ignore' });
          logger.info(`✅ MusicService: Found yt-dlp in system PATH`);
          return 'yt-dlp';
        } catch { continue; }
      }
      if (fs.existsSync(p)) {
        logger.info(`✅ MusicService: Found yt-dlp at: ${p}`);
        return p;
      }
    }
    
    logger.warn(`❌ MusicService: yt-dlp NOT found.`);
    return null;
  },

  /**
   * Clean up old temp files
   */
  cleanup() {
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
