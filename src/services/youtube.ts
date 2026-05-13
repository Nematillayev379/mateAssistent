import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { exec, execSync } from 'child_process';
import { logger } from '../utils/logger';

const execPromise = promisify(exec);

// Use a dedicated temp directory
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
      logger.error(`YoutubeService error: ${e.message}`);
      return null;
    }
  },

  /** Try to extract channel ID from URL */
  async getChannelId(url: string): Promise<string | null> {
    if (url.includes('/channel/')) return url.split('/channel/')[1].split('/')[0];
    if (url.includes('/u/')) return url.split('/u/')[1].split('/')[0];
    if (url.includes('/user/')) return url.split('/user/')[1].split('/')[0];
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
                  results.push({
                    title: video.title?.runs?.[0]?.text || video.title?.simpleText || '',
                    url: `https://www.youtube.com/watch?v=${video.videoId}`
                  });
                }
              }
            }
          } catch {}
        }
      }
      return results;
    } catch (e: any) {
      logger.error(`YouTube search error: ${e.message}`);
      return [];
    }
  },

  /** Extract all video links from a playlist or channel */
  async extractPlaylistLinks(url: string, limit: number = 20): Promise<{ title: string, url: string }[]> {
    try {
      const ytdlpPath = getYtDlpPath();
      if (!ytdlpPath) throw new Error('yt-dlp not found');
      
      // BUG #105 Fix: Use --print instead of deprecated --get-title --get-id
      const { stdout } = await execPromise(`"${ytdlpPath}" --flat-playlist --print "%(id)s|||%(title)s" --max-downloads ${limit} "${url.replace(/"/g, '')}"`, { timeout: 30000 });
      
      const lines = stdout.trim().split('\n').filter(l => l.includes('|||'));
      const results: { title: string, url: string }[] = [];
      for (const line of lines) {
        const [id, title] = line.split('|||');
        if (id && title) {
          results.push({ title, url: `https://www.youtube.com/watch?v=${id}` });
        }
      }
      return results;
    } catch (e: any) {
      logger.error(`Playlist extraction error: ${e.message}`);
      return [];
    }
  }
};

export async function downloadYouTube(urlParam: string, typeParam: 'video' | 'audio'): Promise<string> {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const ext = typeParam === 'audio' ? 'm4a' : 'mp4';
  const filePath = path.join(TEMP_DIR, `yt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`);
  
  // BUG #95 Fix: Sanitize URL to prevent shell injection
  const safeUrl = urlParam.replace(/"/g, '').trim();
  if (!safeUrl.startsWith('http')) throw new Error('Invalid URL');

  const ytdlpPath = getYtDlpPath();
  if (ytdlpPath) {
    try {
      const args = typeParam === 'audio' 
        ? ['-f', 'bestaudio[ext=m4a]', '-o', filePath, safeUrl, '--no-warnings', '--no-playlist', '--max-filesize', '49M']
        : ['-f', 'best[ext=mp4][filesize<50M]/best[filesize<50M]/best', '-o', filePath, safeUrl, '--no-warnings', '--no-playlist'];
      
      const { spawn } = await import('child_process');
      await new Promise((resolve, reject) => {
        const proc = spawn(ytdlpPath, args);
        proc.on('close', (code) => code === 0 ? resolve(true) : reject(new Error(`yt-dlp exited with code ${code}`)));
        proc.on('error', reject);
        // Timeout
        setTimeout(() => { proc.kill(); reject(new Error('Download timeout')); }, 180000);
      });

      if (fs.existsSync(filePath)) return filePath;
    } catch (e: any) {
      logger.warn(`yt-dlp failed: ${e.message}`);
    }
  }

  // BUG #100 Fix: Fallback to Cobalt (consolidated logic)
  try {
    const { DownloaderService } = await import('./downloader');
    const cobaltUrl = await DownloaderService.getCobaltMedia(safeUrl);
    if (cobaltUrl) {
      const response = await axios.get(cobaltUrl, { responseType: 'arraybuffer', timeout: 60000 });
      fs.writeFileSync(filePath, Buffer.from(response.data));
      return filePath;
    }
  } catch (e: any) {
    logger.warn(`Cobalt fallback failed: ${e.message}`);
  }

  throw new Error('Yuklash muvaffaqiyatsiz tugadi.');
}

function getYtDlpPath(): string | null {
  const possiblePaths = [path.join(process.cwd(), 'yt-dlp.exe'), path.join(process.cwd(), 'yt-dlp'), 'yt-dlp'];
  for (const p of possiblePaths) {
    try {
      if (p === 'yt-dlp') { execSync('yt-dlp --version'); return 'yt-dlp'; }
      if (fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}
