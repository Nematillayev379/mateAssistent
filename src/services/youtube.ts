import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { logger } from '../utils/logger';
import { findNewestFile, resolveYtDlpCommand } from '../utils/ytdlp';

interface YouTubeInitialData {
  contents?: {
    twoColumnSearchResultsRenderer?: {
      primaryContents?: {
        sectionListRenderer?: {
          contents?: Array<{
            itemSectionRenderer?: {
              contents?: Array<{
                videoRenderer?: {
                  videoId?: string;
                  title?: {
                    runs?: Array<{ text?: string }>;
                    simpleText?: string;
                  };
                };
              }>;
            };
          }>;
        };
      };
    };
  };
}

interface YoutubeFeedEntry {
  id: string;
  title: string;
  url: string | undefined;
  published: string;
}

let ffmpegStatic: string | null = null;
try { ffmpegStatic = require('ffmpeg-static'); } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.warn(`Failed to require ffmpeg-static: ${msg}`); }

const TEMP_DIR = path.join(os.tmpdir(), 'newsbot_yt');
try { if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true }); } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.warn(`Failed to create TEMP_DIR: ${msg}`); }
const MAX_MEDIA_SIZE = 49 * 1024 * 1024;

function detectExtensionFromContentType(contentType?: string, fallback: string = 'bin'): string {
  const value = String(contentType || '').toLowerCase();
  if (value.includes('audio/mpeg')) return 'mp3';
  if (value.includes('audio/mp4') || value.includes('audio/x-m4a')) return 'm4a';
  if (value.includes('audio/webm')) return 'webm';
  if (value.includes('video/mp4')) return 'mp4';
  return fallback;
}

function validateDownloadedFile(filePath: string, minBytes = 8 * 1024): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const size = fs.statSync(filePath).size;
    return size >= minBytes && size <= MAX_MEDIA_SIZE;
  } catch {
    return false;
  }
}

function findDownloadedMedia(basePrefix: string, preferredExts: string[]): string | null {
  for (const ext of preferredExts) {
    const exact = findNewestFile(TEMP_DIR, basePrefix, ext);
    if (exact && validateDownloadedFile(exact)) return exact;
  }
  const fallback = findNewestFile(TEMP_DIR, basePrefix);
  return fallback && validateDownloadedFile(fallback) ? fallback : null;
}

export const YoutubeService = {
  async getLatestVideo(channelId: string): Promise<YoutubeFeedEntry | null> {
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
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`YoutubeService error: ${msg}`);
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
                const data: YouTubeInitialData = JSON.parse(jsonStr);
                const videos =
                  data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
                    ?.contents?.[0]?.itemSectionRenderer?.contents || [];
                for (const item of videos) {
                  const video = item.videoRenderer;
                  if (video) {
                    results.push({
                      title: video.title?.runs?.[0]?.text || video.title?.simpleText || '',
                      url: `https://www.youtube.com/watch?v=${video.videoId}`,
                    });
                  }
                }
              }
            }
          } catch {
            logger.warn('YouTube search: failed to parse ytInitialData from script tag');
          }
        }
      }
      return results;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`YouTube search error: ${msg}`);
      return [];
    }
  },

  async extractPlaylistLinks(url: string, limit: number = 20): Promise<{ title: string; url: string }[]> {
    try {
      const ytdlpCommand = await resolveYtDlpCommand();
      if (!ytdlpCommand) throw new Error('yt-dlp not found');

      const { execFile } = await import('child_process');
      const { promisify } = await import('util');
      const execFilePromise = promisify(execFile);
      const { stdout } = await execFilePromise(
        ytdlpCommand.command,
        [...ytdlpCommand.args, '--flat-playlist', '--print', '%(id)s|||%(title)s', '--playlist-end', String(limit), url.trim()],
        { timeout: 60000 }
      );

      const lines = stdout.trim().split('\n').filter((l) => l.includes('|||'));
      return lines.map((line) => {
        const [id, title] = line.split('|||');
        return { title, url: `https://www.youtube.com/watch?v=${id}` };
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`Playlist extraction error: ${msg}`);
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
  const ytdlpCommand = await resolveYtDlpCommand();
  let ytdlpFailed = false;

  if (ytdlpCommand) {
    try {
      const { spawn } = await import('child_process');
      const baseOut = path.join(TEMP_DIR, `yt_${stamp}`);
      const args =
        typeParam === 'audio'
          ? [
              '-f',
              'bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio[ext=webm]/bestaudio/best',
              '-o',
              `${baseOut}.%(ext)s`,
              safeUrl,
              '--no-warnings',
              '--no-playlist',
              '--max-filesize',
              '49M',
              '--socket-timeout',
              '30',
              '--retries',
              '3',
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
              '--retries',
              '3',
            ];

      const ffmpegPath = ffmpegStatic || '';

      if (ffmpegPath) {
        args.push('--ffmpeg-location', path.dirname(ffmpegPath));
      }

      let stderrOutput = '';
      await new Promise<void>((resolve, reject) => {
        const proc = spawn(ytdlpCommand.command, [...ytdlpCommand.args, ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
        proc.stderr.on('data', (d: Buffer) => { stderrOutput += d.toString(); });
        const timer = setTimeout(() => {
          proc.kill('SIGKILL');
          reject(new Error('Download timeout (3 min)'));
        }, 180000);
        proc.on('close', (code) => {
          clearTimeout(timer);
          if (code === 0) return resolve();
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

      const preferredExts = typeParam === 'audio' ? ['.m4a', '.mp3', '.webm', '.opus'] : ['.mp4', '.webm', '.mkv'];
      const filePath = findDownloadedMedia(`yt_${stamp}`, preferredExts);
      if (filePath) {
        return filePath;
      }
    } catch (e: unknown) {
      ytdlpFailed = true;
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`yt-dlp strategy failed (${msg.slice(0, 300)}). Trying Cobalt…`);
    }
  }

  try {
    const { DownloaderService } = await import('./downloader');
    const cobaltUrl = await DownloaderService.getCobaltMedia(safeUrl, {
      audioOnly: typeParam === 'audio',
    });
    if (cobaltUrl) {
      try {
        const response = await axios.get(cobaltUrl, {
          responseType: 'arraybuffer',
          timeout: 60000,
          maxContentLength: 52 * 1024 * 1024,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        });
        const contentTypeHeader = response.headers?.['content-type'];
        if (typeof contentTypeHeader === 'string' && contentTypeHeader.includes('application/json')) {
          throw new Error('Cobalt JSON response returned instead of media file');
        }
        const ext = detectExtensionFromContentType(
          typeof contentTypeHeader === 'string' ? contentTypeHeader : undefined,
          typeParam === 'audio' ? 'mp3' : 'mp4'
        );
        const filePath = path.join(TEMP_DIR, `yt_${stamp}.${ext}`);
        fs.writeFileSync(filePath, Buffer.from(response.data));
        if (validateDownloadedFile(filePath)) return filePath;
        try { fs.unlinkSync(filePath); } catch (e: unknown) { const msg = e instanceof Error ? e.message : String(e); logger.warn(`Cleanup: ${msg}`); }
      } catch (dlErr: unknown) {
        const msg = dlErr instanceof Error ? dlErr.message : String(dlErr);
        logger.warn(`Failed to persist Cobalt media locally: ${msg}`);
      }
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const reason = ytdlpFailed ? `yt-dlp ham ishlamadi (${msg.slice(0, 100)})` : '';
    logger.warn(`Cobalt fallback failed: ${reason}`);
  }

  const reason = !ytdlpCommand
    ? 'yt-dlp topilmadi (serverda o\'rnatilmagan)'
    : ytdlpFailed
    ? 'yt-dlp ishlamadi va Cobalt API javob bermadi'
    : 'Cobalt API javob bermadi';
  throw new Error(`Audio/video yuklab bo'lmadi: ${reason}. Iltimos qayta urinib ko'ring yoki boshqa link yuboring.`);
}
