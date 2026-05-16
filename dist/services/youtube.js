"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.YoutubeService = void 0;
exports.downloadYouTube = downloadYouTube;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const child_process_1 = require("child_process");
const logger_1 = require("../utils/logger");
const execPromise = (0, util_1.promisify)(child_process_1.exec);
// Use a dedicated temp directory
const TEMP_DIR = path_1.default.join(os_1.default.tmpdir(), 'newsbot_yt');
if (!fs_1.default.existsSync(TEMP_DIR))
    fs_1.default.mkdirSync(TEMP_DIR, { recursive: true });
exports.YoutubeService = {
    /** Get latest video from channel via RSS */
    async getLatestVideo(channelId) {
        try {
            const url = channelId.startsWith('UC')
                ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
                : `https://www.youtube.com/feeds/videos.xml?user=${channelId}`;
            const res = await axios_1.default.get(url, { timeout: 10000 });
            const $ = cheerio.load(res.data, { xmlMode: true });
            const latestEntry = $('entry').first();
            if (!latestEntry.length)
                return null;
            // BUG-050 Fix: Fallback to regex if cheerio namespace selector fails
            const videoIdMatch = res.data.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
            const id = latestEntry.find('yt\\:videoId').text() || latestEntry.find('videoId').text() || (videoIdMatch ? videoIdMatch[1] : '');
            return {
                id,
                title: latestEntry.find('title').text(),
                url: latestEntry.find('link').attr('href'),
                published: latestEntry.find('published').text()
            };
        }
        catch (e) {
            logger_1.logger.error(`YoutubeService error: ${e.message}`);
            return null;
        }
    },
    /** Try to extract channel ID from URL */
    async getChannelId(url) {
        if (url.includes('/channel/'))
            return url.split('/channel/')[1].split('/')[0];
        if (url.includes('/u/'))
            return url.split('/u/')[1].split('/')[0];
        if (url.includes('/user/'))
            return url.split('/user/')[1].split('/')[0];
        try {
            const res = await axios_1.default.get(url, { timeout: 10000 });
            const match = res.data.match(/"channelId":"(UC[^"]+)"/);
            return match ? match[1] : null;
        }
        catch {
            return null;
        }
    },
    /** Search YouTube videos */
    async searchVideos(query, limit = 5) {
        try {
            const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
            const res = await axios_1.default.get(searchUrl, { timeout: 10000 });
            const $ = cheerio.load(res.data);
            const results = [];
            const scripts = $('script').toArray();
            for (const script of scripts) {
                const scriptText = $(script).text();
                if (scriptText.includes('ytInitialData')) {
                    try {
                        // BUG-051 Fix: More resilient regex for ytInitialData, also matches window["ytInitialData"]
                        const match = scriptText.match(/(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*(\{[\s\S]+?\});/);
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
                    }
                    catch { }
                }
            }
            return results;
        }
        catch (e) {
            logger_1.logger.error(`YouTube search error: ${e.message}`);
            return [];
        }
    },
    /** Extract all video links from a playlist or channel */
    async extractPlaylistLinks(url, limit = 20) {
        try {
            const ytdlpPath = await getYtDlpPath();
            if (!ytdlpPath)
                throw new Error('yt-dlp not found');
            // BUG-052 Fix: Use child_process.execFile to completely prevent shell injection
            const { execFile } = await Promise.resolve().then(() => __importStar(require('child_process')));
            const execFilePromise = (0, util_1.promisify)(execFile);
            const { stdout } = await execFilePromise(ytdlpPath, [
                '--flat-playlist',
                '--print', '%(id)s|||%(title)s',
                '--max-downloads', String(limit),
                url.trim()
            ], { timeout: 30000 });
            const lines = stdout.trim().split('\n').filter(l => l.includes('|||'));
            const results = [];
            for (const line of lines) {
                const [id, title] = line.split('|||');
                if (id && title) {
                    results.push({ title, url: `https://www.youtube.com/watch?v=${id}` });
                }
            }
            return results;
        }
        catch (e) {
            logger_1.logger.error(`Playlist extraction error: ${e.message}`);
            return [];
        }
    }
};
async function downloadYouTube(urlParam, typeParam) {
    if (!fs_1.default.existsSync(TEMP_DIR))
        fs_1.default.mkdirSync(TEMP_DIR, { recursive: true });
    const ext = typeParam === 'audio' ? 'm4a' : 'mp4';
    const filePath = path_1.default.join(TEMP_DIR, `yt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`);
    // BUG #95 Fix: Sanitize URL to prevent shell injection
    const safeUrl = urlParam.replace(/"/g, '').trim();
    if (!safeUrl.startsWith('http'))
        throw new Error('Invalid URL');
    const ytdlpPath = await getYtDlpPath();
    if (ytdlpPath) {
        try {
            const args = typeParam === 'audio'
                ? ['-f', 'bestaudio[ext=m4a]', '-o', filePath, safeUrl, '--no-warnings', '--no-playlist', '--max-filesize', '49M']
                : ['-f', 'best[ext=mp4][filesize<50M]/best[filesize<50M]/best', '-o', filePath, safeUrl, '--no-warnings', '--no-playlist'];
            const { spawn } = await Promise.resolve().then(() => __importStar(require('child_process')));
            await new Promise((resolve, reject) => {
                const proc = spawn(ytdlpPath, args);
                proc.on('close', (code) => code === 0 ? resolve(true) : reject(new Error(`yt-dlp exited with code ${code}`)));
                proc.on('error', reject);
                // Timeout
                // BUG-053 Fix: Use SIGKILL to forcefully terminate hanging yt-dlp processes
                setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Download timeout')); }, 180000);
            });
            if (fs_1.default.existsSync(filePath))
                return filePath;
        }
        catch (e) {
            logger_1.logger.warn(`yt-dlp failed: ${e.message}`);
        }
    }
    // BUG #100 Fix: Fallback to Cobalt (consolidated logic)
    try {
        const { DownloaderService } = await Promise.resolve().then(() => __importStar(require('./downloader')));
        const cobaltUrl = await DownloaderService.getCobaltMedia(safeUrl);
        if (cobaltUrl) {
            const response = await axios_1.default.get(cobaltUrl, { responseType: 'arraybuffer', timeout: 60000 });
            fs_1.default.writeFileSync(filePath, Buffer.from(response.data));
            return filePath;
        }
    }
    catch (e) {
        logger_1.logger.warn(`Cobalt fallback failed: ${e.message}`);
    }
    throw new Error('Yuklash muvaffaqiyatsiz tugadi.');
}
// BUG-054 Fix: Cache path to avoid blocking event loop with execSync on every call
let cachedYtDlpPath = null;
let ytDlpChecked = false;
async function getYtDlpPath() {
    if (ytDlpChecked)
        return cachedYtDlpPath;
    const possiblePaths = [path_1.default.join(process.cwd(), 'yt-dlp.exe'), path_1.default.join(process.cwd(), 'yt-dlp'), 'yt-dlp'];
    for (const p of possiblePaths) {
        try {
            if (p === 'yt-dlp') {
                await execPromise('yt-dlp --version');
                cachedYtDlpPath = 'yt-dlp';
                break;
            }
            if (fs_1.default.existsSync(p)) {
                cachedYtDlpPath = p;
                break;
            }
        }
        catch { }
    }
    ytDlpChecked = true;
    return cachedYtDlpPath;
}
