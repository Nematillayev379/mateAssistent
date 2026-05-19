import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger';
import { findNewestFile, resolveYtDlpPath } from '../utils/ytdlp';

const TEMP_DIR = path.join(os.tmpdir(), 'newsbot_yt');
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

export const YoutubeService = {
  async getLatestVideo(channelId: string) {
    try {
      const url = channelId.startsWith('UC')
        ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
        : `https://www.youtube.com/feeds/videos.xml?user=${channelId}`;

      const res = await axios.get(url, { timeout: 10000 });
      const $ = cheerio.load(res.data, { xmlMode: true });
      const latestEntry = $('entry').first();
      if (!latestEntry.length) return null;

      const videoIdMatch = res.data.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
      const id =
        latestEntry.find('yt\\:videoId').text() ||
        latestEntry.find('videoId').text() ||
        (videoIdMatch ? videoIdMatch[1] : '');

      return {
        id,
        title: latestEntry.find('title').text(),
        url: latestEntry.find('link').attr('href'),
        published: latestEntry.find('published').text(),
      };
    } catch (e: any) {
      logger.error(`YoutubeService error: ${e.message}`);
      return null;
    }
  },

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

  async searchVideos(query: string, limit: number = 5): Promise<{ title: string; url: string }[]> {
    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
      const res = await axios.get(searchUrl, { timeout: 10000 });
      const $ = cheerio.load(res.data);
      const results: { title: string; url: string }[] = [];
      const scripts = $('script').toArray();
      for (const script of scripts) {
        const scriptText = $(script).text();
        if (scriptText.includes('ytInitialData')) {
          try {
            const startIndex = scriptText.indexOf('ytInitialData');
            if (startIndex !== -1) {
              const jsonStart = scriptText.indexOf('{', startIndex);
              const jsonEnd = scriptText.lastIndexOf('}');
              if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                const jsonStr = scriptText.slice(jsonStart, jsonEnd + 1);
                const data = JSON.parse(jsonStr);
                const videos =
                  data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
                    ?.contents?.[0]?.itemSectionRenderer?.contents || [];
                for (const item of videos) {
                  if (item.videoRenderer) {
                    const video = item.videoRenderer;
                    results.push({
                      title: video.title?.runs?.[0]?.text || video.title?.simpleText || '',
                      url: `https://www.youtube.com/watch?v=${video.videoId}`,
                    });
                  }
                }
              }
            }
          } catch {
            /* ignore */
          }
        }
      }
      return results;
    } catch (e: any) {
      logger.error(`YouTube search error: ${e.message}`);
      return [];
    }
  },

  async extractPlaylistLinks(url: string, limit: number = 20): Promise<{ title: string; url: string }[]> {
    try {
      const ytdlpPath = await resolveYtDlpPath();
      if (!ytdlpPath) throw new Error('yt-dlp not found');

      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFilePromise = promisify(execFile);
      const { stdout } = await execFilePromise(
        ytdlpPath,
        ['--flat-playlist', '--print', '%(id)s|||%(title)s', '--playlist-end', String(limit), url.trim()],
        { timeout: 60000 }
      );

      const lines = stdout.trim().split('\n').filter((l) => l.includes('|||'));
      return lines.map((line) => {
        const [id, title] = line.split('|||');
        return { title, url: `https://www.youtube.com/watch?v=${id}` };
      });
    } catch (e: any) {
      logger.error(`Playlist extraction error: ${e.message}`);
      return [];
    }
  },
};

export async function downloadYouTube(urlParam: string, typeParam: 'video' | 'audio'): Promise<string> {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  let safeUrl = urlParam.replace(/"/g, '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(safeUrl)) {
    safeUrl = `https://www.youtube.com/watch?v=${safeUrl}`;
  }
  if (!safeUrl.startsWith('http')) throw new Error('Invalid URL');

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const ytdlpPath = await resolveYtDlpPath();
  let ytdlpFailed = false;

  // BUG-XXX Fix: Capture stderr from yt-dlp to diagnose binary/execution issues on Windows
  if (ytdlpPath) {
    try {
      const { spawn } = await import('child_process');
      const baseOut = path.join(TEMP_DIR, `yt_${stamp}`);
      const args =
        typeParam === 'audio'
          ? [
              '-f',
              'bestaudio[ext=m4a]/bestaudio/best',
              '-o',
              `${baseOut}.%(ext)s`,
              safeUrl,
              '--no-warnings',
              '--no-playlist',
              '--max-filesize',
              '49M',
              '--socket-timeout',
              '30',
            ]
          : [
              '-f',
              'best[ext=mp4][filesize<50M]/best[filesize<50M]/best',
              '-o',
              `${baseOut}.%(ext)s`,
              safeUrl,
              '--no-warnings',
              '--no-playlist',
              '--max-filesize',
              '49M',
              '--socket-timeout',
              '30',
            ];

      let ffmpegPath = '';
      try {
        ffmpegPath = require('ffmpeg-static') || '';
      } catch (e) {}

      if (ffmpegPath) {
        args.push('--ffmpeg-location', path.dirname(ffmpegPath));
      }

      let stderrOutput = '';
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ytdlpPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        proc.stderr.on('data', (d: Buffer) => { stderrOutput += d.toString(); });
        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          reject(new Error('Download timeout (3 min)'));
        }, 180000);
        proc.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) return resolve();
          // BUG-XXX Fix: Include stderr in error to help diagnose yt-dlp binary issues
          const errMsg = stderrOutput
            ? `yt-dlp exited with code ${code}: ${stderrOutput.slice(0, 200)}`
            : `yt-dlp exited with code ${code}`;
          reject(new Error(errMsg));
        });
        proc.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      const ext = typeParam === 'audio' ? '.m4a' : '.mp4';
      let filePath = findNewestFile(TEMP_DIR, `yt_${stamp}`, ext);
      if (!filePath) filePath = findNewestFile(TEMP_DIR, `yt_${stamp}`);
      if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
        return filePath;
      }
    } catch (e: any) {
      ytdlpFailed = true;
      // BUG-XXX Fix: Log full error including stderr to aid debugging
      logger.warn(`yt-dlp strategy failed (${e.message.slice(0, 300)}). Trying Cobalt…`);
    }
  }

  // Only attempt Cobalt as fallback if yt-dlp is absent or failed
  try {
    const { DownloaderService } = await import('./downloader');
    const cobaltUrl = await DownloaderService.getCobaltMedia(safeUrl, {
      audioOnly: typeParam === 'audio',
    });
    if (cobaltUrl) {
      const ext = typeParam === 'audio' ? 'm4a' : 'mp4';
      const filePath = path.join(TEMP_DIR, `yt_${stamp}.${ext}`);
      const response = await axios.get(cobaltUrl, {
        responseType: 'arraybuffer',
        timeout: 120000,
        maxContentLength: 52 * 1024 * 1024,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      fs.writeFileSync(filePath, Buffer.from(response.data));
      if (fs.statSync(filePath).size > 0) return filePath;
    }
  } catch (e: any) {
    const reason = ytdlpFailed ? `yt-dlp ham ishlamadi (${e.message.slice(0, 100)})` : '';
    logger.warn(`Cobalt fallback failed: ${reason}`);
  }

  throw new Error('Yuklash muvaffaqiyatsiz. yt-dlp yoki Cobalt ishlamadi. Keyinroq urinib ko‘ring yoki buni muvofiq qiling.');
}
