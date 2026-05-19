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
const logger_1 = require("../utils/logger");
const ytdlp_1 = require("../utils/ytdlp");
const TEMP_DIR = path_1.default.join(os_1.default.tmpdir(), 'newsbot_yt');
if (!fs_1.default.existsSync(TEMP_DIR))
    fs_1.default.mkdirSync(TEMP_DIR, { recursive: true });
exports.YoutubeService = {
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
            const videoIdMatch = res.data.match(/<yt:videoId>([^<]+)<\/yt:videoId>/);
            const id = latestEntry.find('yt\\:videoId').text() ||
                latestEntry.find('videoId').text() ||
                (videoIdMatch ? videoIdMatch[1] : '');
            return {
                id,
                title: latestEntry.find('title').text(),
                url: latestEntry.find('link').attr('href'),
                published: latestEntry.find('published').text(),
            };
        }
        catch (e) {
            logger_1.logger.error(`YoutubeService error: ${e.message}`);
            return null;
        }
    },
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
                        const startIndex = scriptText.indexOf('ytInitialData');
                        if (startIndex !== -1) {
                            const jsonStart = scriptText.indexOf('{', startIndex);
                            const jsonEnd = scriptText.lastIndexOf('}');
                            if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                                const jsonStr = scriptText.slice(jsonStart, jsonEnd + 1);
                                const data = JSON.parse(jsonStr);
                                const videos = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer
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
                    }
                    catch {
                        /* ignore */
                    }
                }
            }
            return results;
        }
        catch (e) {
            logger_1.logger.error(`YouTube search error: ${e.message}`);
            return [];
        }
    },
    async extractPlaylistLinks(url, limit = 20) {
        try {
            const ytdlpPath = await (0, ytdlp_1.resolveYtDlpPath)();
            if (!ytdlpPath)
                throw new Error('yt-dlp not found');
            const { execFile } = await Promise.resolve().then(() => __importStar(require('child_process')));
            const { promisify } = await Promise.resolve().then(() => __importStar(require('util')));
            const execFilePromise = promisify(execFile);
            const { stdout } = await execFilePromise(ytdlpPath, ['--flat-playlist', '--print', '%(id)s|||%(title)s', '--playlist-end', String(limit), url.trim()], { timeout: 60000 });
            const lines = stdout.trim().split('\n').filter((l) => l.includes('|||'));
            return lines.map((line) => {
                const [id, title] = line.split('|||');
                return { title, url: `https://www.youtube.com/watch?v=${id}` };
            });
        }
        catch (e) {
            logger_1.logger.error(`Playlist extraction error: ${e.message}`);
            return [];
        }
    },
};
async function downloadYouTube(urlParam, typeParam) {
    if (!fs_1.default.existsSync(TEMP_DIR))
        fs_1.default.mkdirSync(TEMP_DIR, { recursive: true });
    const safeUrl = urlParam.replace(/"/g, '').trim();
    if (!safeUrl.startsWith('http'))
        throw new Error('Invalid URL');
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const ytdlpPath = await (0, ytdlp_1.resolveYtDlpPath)();
    let ytdlpFailed = false;
    // BUG-XXX Fix: Capture stderr from yt-dlp to diagnose binary/execution issues on Windows
    if (ytdlpPath) {
        try {
            const { spawn } = await Promise.resolve().then(() => __importStar(require('child_process')));
            const baseOut = path_1.default.join(TEMP_DIR, `yt_${stamp}`);
            const args = typeParam === 'audio'
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
            }
            catch (e) { }
            if (ffmpegPath) {
                args.push('--ffmpeg-location', path_1.default.dirname(ffmpegPath));
            }
            let stderrOutput = '';
            await new Promise((resolve, reject) => {
                const proc = spawn(ytdlpPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
                proc.stderr.on('data', (d) => { stderrOutput += d.toString(); });
                const timer = setTimeout(() => {
                    proc.kill('SIGKILL');
                    reject(new Error('Download timeout (3 min)'));
                }, 180000);
                proc.on('close', (code) => {
                    clearTimeout(timer);
                    if (code === 0)
                        return resolve();
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
            let filePath = (0, ytdlp_1.findNewestFile)(TEMP_DIR, `yt_${stamp}`, ext);
            if (!filePath)
                filePath = (0, ytdlp_1.findNewestFile)(TEMP_DIR, `yt_${stamp}`);
            if (filePath && fs_1.default.existsSync(filePath) && fs_1.default.statSync(filePath).size > 0) {
                return filePath;
            }
        }
        catch (e) {
            ytdlpFailed = true;
            // BUG-XXX Fix: Log full error including stderr to aid debugging
            logger_1.logger.warn(`yt-dlp strategy failed (${e.message.slice(0, 300)}). Trying Cobalt…`);
        }
    }
    // Only attempt Cobalt as fallback if yt-dlp is absent or failed
    try {
        const { DownloaderService } = await Promise.resolve().then(() => __importStar(require('./downloader')));
        const cobaltUrl = await DownloaderService.getCobaltMedia(safeUrl, {
            audioOnly: typeParam === 'audio',
        });
        if (cobaltUrl) {
            const ext = typeParam === 'audio' ? 'm4a' : 'mp4';
            const filePath = path_1.default.join(TEMP_DIR, `yt_${stamp}.${ext}`);
            const response = await axios_1.default.get(cobaltUrl, {
                responseType: 'arraybuffer',
                timeout: 120000,
                maxContentLength: 52 * 1024 * 1024,
                headers: { 'User-Agent': 'Mozilla/5.0' },
            });
            fs_1.default.writeFileSync(filePath, Buffer.from(response.data));
            if (fs_1.default.statSync(filePath).size > 0)
                return filePath;
        }
    }
    catch (e) {
        const reason = ytdlpFailed ? `yt-dlp ham ishlamadi (${e.message.slice(0, 100)})` : '';
        logger_1.logger.warn(`Cobalt fallback failed: ${reason}`);
    }
    throw new Error('Yuklash muvaffaqiyatsiz. yt-dlp yoki Cobalt ishlamadi. Keyinroq urinib ko‘ring yoki buni muvofiq qiling.');
}
