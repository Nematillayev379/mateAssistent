import axios from 'axios';
import cheerio from 'cheerio';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { exec, execSync } from 'child_process';
import { logger } from '../utils/logger';

const execPromise = promisify(exec);

// Use a dedicated temp directory (not process.cwd()/tmp which may not exist)
const TEMP_DIR = path.join(os.tmpdir(), 'newsbot_yt');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

export const YoutubeService = {
  /** Get latest video from channel via RSS */
  async getLatestVideo(channelId: string) {
    try {
      const url = channelId.startsWith('UC') 
        ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
        : `https://www.youtube.com/feeds/videos.xml?user=${channelId}`;

      const res = await axios.get(url, { timeout: 10000 });
      const $ = cheerio.load(res.data, { xmlMode: true });
      const latestEntry = $('entry').first();
      
      if (!latestEntry.length) return null;

      return {
        id: latestEntry.find('yt\\:videoId').text() || latestEntry.find('videoId').text(),
        title: latestEntry.find('title').text(),
        url: latestEntry.find('link').attr('href'),
        published: latestEntry.find('published').text()
      };
    } catch (e: any) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.error(`YoutubeService error: ${errorMessage}`);
      return null;
    }
  },

  /** Try to extract channel ID from URL */
  async getChannelId(url: string): Promise<string | null> {
    if (url.includes('/channel/')) return url.split('/channel/')[1].split('/')[0];
    if (url.includes('/u/')) return url.split('/u/')[1].split('/')[0];
    if (url.includes('/user/')) return url.split('/user/')[1].split('/')[0];
    
    // For @handles, we need to fetch page and find is channelId
    try {
      const res = await axios.get(url, { timeout: 10000 });
      const match = res.data.match(/"channelId":"(UC[^"]+)"/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  },

  /** Search YouTube videos */
  async searchVideos(query: string, limit: number = 5): Promise<{ title: string, url: string }[]> {
    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const res = await axios.get(searchUrl, { timeout: 10000 });
      const $ = cheerio.load(res.data);
      
      const results: { title: string, url: string }[] = [];
      
      // Try to find ytInitialData JSON
      const scripts = $('script').toArray();
      for (const script of scripts) {
        const scriptText = $(script).text();
        if (scriptText.includes('ytInitialData')) {
          try {
            const match = scriptText.match(/var ytInitialData = ([\s\S]+?);<\/script>/);
            if (match) {
              const data = JSON.parse(match[1]);
              const videos = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

              for (const item of videos) {
                if (item.videoRenderer) {
                  const video = item.videoRenderer;
                  const videoId = video.videoId;
                  const videoTitle = video.title?.runs?.[0]?.text || video.title?.simpleText || '';

                  if (videoId && videoTitle) {
                    results.push({
                      title: videoTitle,
                      url: `https://www.youtube.com/watch?v=${videoId}`
                    });
                  }
                }
              }
            }
          } catch (e) {
            logger.warn(`ytInitialData parse failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
          }
        }
      }
      
      return results;
    } catch (e: any) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.error(`YouTube search error: ${errorMessage}`);
      return [];
    }
  },
};

/**
 * Download YouTube video or audio using yt-dlp (primary) or ytdl-core (fallback)
 * Fully wrapped in try/catch to prevent process crashes
 */
export async function downloadYouTube(urlParam: string, typeParam: 'video' | 'audio'): Promise<string> {
  // Ensure temp directory exists
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const ext = typeParam === 'audio' ? 'm4a' : 'mp4';
  const filePath = path.join(TEMP_DIR, `yt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`);
  const maxBytes = (parseInt(process.env.YOUTUBE_MAX_SIZE_MB || '50') * 1024 * 1024);

  // Strategy 1: yt-dlp (most reliable)
  const ytdlpPath = getYtDlpPath();
  if (ytdlpPath) {
    try {
      logger.info(`Downloading YouTube ${typeParam} with yt-dlp: ${urlParam}`);
      
      let command: string;
      if (typeParam === 'audio') {
        command = `"${ytdlpPath}" -f "bestaudio[ext=m4a]" -o "${filePath}" "${urlParam}" --no-warnings --no-playlist --max-filesize 49M`;
      } else {
        command = `"${ytdlpPath}" -f "best[ext=mp4][filesize<50M]/best[filesize<50M]/best" -o "${filePath}" "${urlParam}" --no-warnings --no-playlist`;
      }

      await execPromise(command, { timeout: 120000 });

      // yt-dlp may create a file with a slightly different name
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > 0 && stats.size <= maxBytes) {
          logger.info(`YouTube ${typeParam} saved: ${filePath} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
          return filePath;
        }
        // File too big
        if (stats.size > maxBytes) {
          fs.unlinkSync(filePath);
          throw new Error(`Fayl hajmi ${(stats.size / 1024 / 1024).toFixed(1)}MB - chegaradan oshib ketdi`);
        }
      }
      
      // Check for yt-dlp generated file names (sometimes adds suffix)
      const altNames = [
        filePath.replace(/\.[a-zA-Z0-9]+$/, '') + '.webm',
        filePath.replace(/\.[a-zA-Z0-9]+$/, '') + '.opus',
      ];
      for (const alt of altNames) {
        if (fs.existsSync(alt)) {
          const stats = fs.statSync(alt);
          if (stats.size > 0 && stats.size <= maxBytes) {
          logger.info(`YouTube ${typeParam} saved: ${alt} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
            return alt;
          }
        }
      }
    } catch (e: any) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.warn(`yt-dlp download failed: ${errorMessage.slice(0, 150)}`);
      // Cleanup on failure
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    }
  }

  // Strategy 2: @distube/ytdl-core (fallback)
  try {
    logger.info(`Trying ytdl-core for: ${urlParam}`);
    const ytdl = require('@distube/ytdl-core');
    
    const info = await ytdl.getInfo(urlParam);
    const title = info.videoDetails.title.replace(/[<>:"/\\|?*]+/g, '_');
    
    const fallbackPath = path.join(TEMP_DIR, `yt_${Date.now()}_${title.slice(0, 30)}.${ext}`);

    const stream = ytdl(urlParam, {
      quality: typeParam === 'audio' ? 'highestaudio' : 'highestvideo',
      filter: typeParam === 'audio' ? 'audioonly' : 'audioandvideo',
    });

    const write = fs.createWriteStream(fallbackPath);
    stream.pipe(write);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Download timeout (120s)')), 120000);
      write.on('finish', () => { clearTimeout(timeout); resolve(); });
      write.on('error', (err: Error) => { clearTimeout(timeout); reject(err); });
      stream.on('error', (err: Error) => { clearTimeout(timeout); reject(err); });
    });

    const stats = fs.statSync(fallbackPath);
    if (stats.size > maxBytes) {
      fs.unlinkSync(fallbackPath);
      throw new Error(`Fayl hajmi ${(stats.size / 1024 / 1024).toFixed(1)}MB - chegaradan oshib ketdi`);
    }

    logger.info(`YouTube ${typeParam} saved via ytdl-core: ${fallbackPath} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
    return fallbackPath;
  } catch (e: any) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logger.error(`ytdl-core also failed: ${errorMessage}`);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }

  // Strategy 3: Cobalt API
  try {
    logger.info(`Trying Cobalt API for: ${urlParam}`);
    const { DownloaderService } = require('./downloader');
    const cobaltUrl = await DownloaderService.getCobaltMedia(urlParam);
    if (cobaltUrl) {
      // Download to file
      const cobaltPath = path.join(TEMP_DIR, `yt_cobalt_${Date.now()}.${ext}`);
      const writer = fs.createWriteStream(cobaltPath);
      const response = await axios.get(cobaltUrl, { responseType: 'stream', timeout: 60000 });
      response.data.pipe(writer);
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Cobalt download timeout')), 60000);
        writer.on('finish', () => { clearTimeout(timeout); resolve(); });
        writer.on('error', (err: Error) => { clearTimeout(timeout); reject(err); });
      });

      if (fs.existsSync(cobaltPath)) {
        const stats = fs.statSync(cobaltPath);
        if (stats.size > 0) {
          logger.info(`YouTube ${typeParam} saved via Cobalt: ${cobaltPath} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
          return cobaltPath;
        }
      }
    }
  } catch (e: any) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    logger.error(`Cobalt also failed: ${errorMessage}`);
  }

  throw new Error('Barcha yuklash usullari ishlamadi. Iltimos, boshqa havola bilan urinib ko\'ring.');
}

/**
 * Find yt-dlp binary
 */
function getYtDlpPath(): string | null {
  const possiblePaths = [
    path.join(process.cwd(), 'yt-dlp.exe'),
    path.join(process.cwd(), 'yt-dlp'),
    'yt-dlp'
  ];

  logger.info(`🔍 Checking for yt-dlp in: ${JSON.stringify(possiblePaths)}`);

  for (const p of possiblePaths) {
    if (p === 'yt-dlp') {
      try {
        execSync('yt-dlp --version', { timeout: 5000, stdio: 'ignore' });
        logger.info(`✅ Found yt-dlp in system PATH`);
        return 'yt-dlp';
      } catch { continue; }
    }
    if (fs.existsSync(p)) {
      logger.info(`✅ Found yt-dlp at: ${p}`);
      return p;
    }
  }
  
  logger.warn(`❌ yt-dlp NOT found in any of the expected paths.`);
  return null;
}
