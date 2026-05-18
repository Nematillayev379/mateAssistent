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
exports.MusicService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const ytdlp_1 = require("../utils/ytdlp");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execPromise = (0, util_1.promisify)(child_process_1.exec);
const TEMP_DIR = path_1.default.join(os_1.default.tmpdir(), 'newsbot_music');
if (!fs_1.default.existsSync(TEMP_DIR))
    fs_1.default.mkdirSync(TEMP_DIR, { recursive: true });
const MAX_FILE_SIZE = 49 * 1024 * 1024; // 49MB (Telegram limit = 50MB)
exports.MusicService = {
    /**
     * Main search function: tries multiple strategies in order
     * 1. yt-dlp (most reliable - supports YouTube, SoundCloud, etc.)
     * 2. Cobalt API (YouTube audio extraction)
     * 3. Direct YouTube search + yt-dlp download
     */
    async searchAndDownload(artist, amount = 5) {
        const results = [];
        // Strategy 1: yt-dlp YouTube search + download (most reliable)
        try {
            logger_1.logger.info(`MusicService: yt-dlp orqali "${(0, logger_1.sanitizeLogInput)(artist)}" qidirilmoqda...`);
            const ytdlpResults = await this.searchWithYtDlp(artist, amount);
            results.push(...ytdlpResults);
        }
        catch (e) {
            logger_1.logger.warn(`MusicService: yt-dlp strategy failed: ${e.message}`);
        }
        // BUG-114 Fix: If strategy 1 found anything, do not fall through to other strategies, as they will likely fail too and just waste time
        if (results.length === 0) {
            try {
                logger_1.logger.info(`MusicService: Cobalt API orqali qidirilmoqda...`);
                const cobaltResults = await this.searchWithCobalt(artist, amount);
                results.push(...cobaltResults);
            }
            catch (e) {
                logger_1.logger.warn(`MusicService: Cobalt strategy failed: ${e.message}`);
            }
        }
        // Strategy 3: If still not enough, try direct YouTube video IDs + download
        if (results.length === 0) {
            try {
                logger_1.logger.info(`MusicService: YouTube scrape orqali qidirilmoqda...`);
                const ytResults = await this.searchWithYouTubeScrape(artist, amount);
                results.push(...ytResults);
            }
            catch (e) {
                logger_1.logger.warn(`MusicService: YouTube scrape strategy failed: ${e.message}`);
            }
        }
        // BUG-055 Fix: Throw error if no results found so caller can notify user
        if (results.length === 0) {
            throw new Error("Musiqa topilmadi yoki yuklashda xatolik yuz berdi. Iltimos keyinroq urinib ko'ring.");
        }
        return results.slice(0, amount);
    },
    // Backward compatibility alias
    async searchAndDownloadMuzFm(artist, amount = 5) {
        return this.searchAndDownload(artist, amount);
    },
    /**
     * Strategy 1: Use yt-dlp to search YouTube and download audio directly
     */
    async searchWithYtDlp(artist, amount) {
        const results = [];
        // BUG-113 & BUG-054 Fix: Use cached path
        const ytdlpPath = await this.getYtDlpPathAsync();
        if (!ytdlpPath) {
            logger_1.logger.warn('yt-dlp topilmadi, skip');
            return results;
        }
        try {
            // First search for video URLs
            const safeArtist = artist.replace(/"/g, '').trim();
            const searchQuery = `${safeArtist} music audio`;
            const { spawn } = await Promise.resolve().then(() => __importStar(require('child_process')));
            const stdout = await new Promise((resolve, reject) => {
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
            const seen = new Set();
            for (const line of lines) {
                if (results.length >= amount)
                    break;
                const [videoId, title] = line.split('|||');
                if (!videoId || !title || seen.has(videoId))
                    continue;
                seen.add(videoId);
                const filePath = path_1.default.join(TEMP_DIR, `music_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.m4a`);
                try {
                    // BUG-113 Fix: Use child_process.execFile to prevent shell injection and maxBuffer issues
                    const { execFile } = await Promise.resolve().then(() => __importStar(require('child_process')));
                    const execFilePromise = (0, util_1.promisify)(execFile);
                    await execFilePromise(ytdlpPath, ['-f', 'bestaudio[ext=m4a]', '-o', filePath, `https://www.youtube.com/watch?v=${videoId}`, '--no-warnings', '--no-playlist', '--max-filesize', '49M'], { timeout: 60000, maxBuffer: 1024 * 1024 });
                    if (fs_1.default.existsSync(filePath)) {
                        const stats = fs_1.default.statSync(filePath);
                        if (stats.size > 0 && stats.size < MAX_FILE_SIZE) {
                            results.push({ title: title.trim(), path: filePath });
                            logger_1.logger.info(`✅ Music downloaded: ${(0, logger_1.sanitizeLogInput)(title.trim())} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
                        }
                        else {
                            // B-14 Fix: Delete temp file if invalid size
                            try {
                                fs_1.default.unlinkSync(filePath);
                            }
                            catch { }
                        }
                    }
                    // B-13 Fix: Check alt paths only if primary file doesn't exist
                    const altExtensions = ['.webm', '.opus', '.mp3'];
                    for (const altExt of altExtensions) {
                        const altPath = filePath.replace(/\.[a-zA-Z0-9]+$/, '') + altExt;
                        if (fs_1.default.existsSync(altPath)) {
                            const stats = fs_1.default.statSync(altPath);
                            if (stats.size > 0 && stats.size < MAX_FILE_SIZE) {
                                results.push({ title: title.trim(), path: altPath });
                                logger_1.logger.info(`✅ Music downloaded: ${(0, logger_1.sanitizeLogInput)(title.trim())} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
                                break;
                            }
                        }
                    }
                }
                catch (dlErr) {
                    logger_1.logger.warn(`yt-dlp download error for "${(0, logger_1.sanitizeLogInput)(title)}": ${dlErr.message?.slice(0, 100)}`);
                    try {
                        if (fs_1.default.existsSync(filePath))
                            fs_1.default.unlinkSync(filePath);
                    }
                    catch { }
                }
            }
        }
        catch (e) {
            logger_1.logger.warn(`yt-dlp search error: ${e.message?.slice(0, 200)}`);
        }
        // B-54 Fix: Deduplicate search results by title
        const uniqueResults = new Map();
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
    async searchWithCobalt(artist, amount) {
        const results = [];
        // Get video URLs from YouTube search
        const videos = await this.getYouTubeVideoIds(artist, amount * 2);
        const cobaltInstances = [
            'https://api.cobalt.tools',
            'https://cobalt.canine.tools',
            'https://cobalt.meowing.de',
        ];
        for (const video of videos) {
            if (results.length >= amount)
                break;
            for (const base of cobaltInstances) {
                try {
                    const res = await axios_1.default.post(`${base}/`, {
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
                    if (!audioUrl)
                        continue;
                    // Download the audio file
                    const filePath = path_1.default.join(TEMP_DIR, `music_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.mp3`);
                    const writer = fs_1.default.createWriteStream(filePath);
                    const audioRes = await axios_1.default.get(audioUrl, { responseType: 'stream', timeout: 30000 });
                    audioRes.data.pipe(writer);
                    // B-15 Fix: Add resolved flag to prevent race condition
                    let resolved = false;
                    await new Promise((resolve, reject) => {
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
                    if (fs_1.default.existsSync(filePath)) {
                        const stats = fs_1.default.statSync(filePath);
                        if (stats.size > 10000 && stats.size < MAX_FILE_SIZE) {
                            results.push({ title: video.title, path: filePath });
                            logger_1.logger.info(`✅ Cobalt download: ${(0, logger_1.sanitizeLogInput)(video.title)} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
                            break; // Success, move to next video
                        }
                        else {
                            // B-14 Fix: Delete temp file if invalid size
                            try {
                                fs_1.default.unlinkSync(filePath);
                            }
                            catch { }
                        }
                    }
                }
                catch (e) {
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
    async searchWithYouTubeScrape(artist, amount) {
        const results = [];
        const videos = await this.getYouTubeVideoIds(artist, amount * 2);
        const ytdlpPath = await this.getYtDlpPathAsync();
        for (const video of videos) {
            if (results.length >= amount)
                break;
            if (ytdlpPath) {
                const filePath = path_1.default.join(TEMP_DIR, `music_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.m4a`);
                try {
                    // BUG-113 Fix: execFile usage
                    const { execFile } = await Promise.resolve().then(() => __importStar(require('child_process')));
                    const execFilePromise = (0, util_1.promisify)(execFile);
                    await execFilePromise(ytdlpPath, ['-f', 'bestaudio[ext=m4a]', '-o', filePath, video.url, '--no-warnings', '--no-playlist', '--max-filesize', '49M'], { timeout: 60000, maxBuffer: 1024 * 1024 });
                    if (fs_1.default.existsSync(filePath)) {
                        const stats = fs_1.default.statSync(filePath);
                        if (stats.size > 0 && stats.size < MAX_FILE_SIZE) {
                            results.push({ title: video.title, path: filePath });
                        }
                        else {
                            // B-14 Fix: Delete temp file if invalid size
                            try {
                                fs_1.default.unlinkSync(filePath);
                            }
                            catch { }
                        }
                    }
                }
                catch (e) {
                    try {
                        if (fs_1.default.existsSync(filePath))
                            fs_1.default.unlinkSync(filePath);
                    }
                    catch { }
                }
            }
        }
        return results;
    },
    /**
        * Search YouTube and return video IDs + titles
        * B-48 Fix: Improved parsing with better error handling and fallbacks
        */
    async getYouTubeVideoIds(query, limit = 10) {
        const results = [];
        // Strategy 1: Direct YouTube scraping with multiple user agents
        try {
            const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' audio music')}&sp=EgIQAQ%253D%253D`;
            const res = await axios_1.default.get(searchUrl, {
                timeout: 15000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            const body = res.data;
            // BUG-057 Fix: Support modern regex and fallbacks for YouTube search changes
            const jsonMatch = body.match(/(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*({[\s\S]*?});/);
            if (jsonMatch) {
                try {
                    const data = JSON.parse(jsonMatch[1]);
                    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
                    if (contents) {
                        for (const item of contents) {
                            if (results.length >= limit)
                                break;
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
                }
                catch (parseErr) {
                    logger_1.logger.warn(`YouTube JSON parsing failed: ${parseErr.message}`);
                }
            }
        }
        catch (e) {
            logger_1.logger.warn(`YouTube search error: ${e.message}`);
        }
        // Strategy 2: Fallback to yt-dlp for video IDs
        if (results.length === 0) {
            const ytdlpResults = await this.searchYouTubeIdsWithYtDlp(query, limit);
            results.push(...ytdlpResults);
        }
        return results;
    },
    async searchYouTubeIdsWithYtDlp(query, limit) {
        const results = [];
        const ytdlpPath = await (0, ytdlp_1.resolveYtDlpPath)();
        if (!ytdlpPath)
            return results;
        try {
            const { execFile } = await Promise.resolve().then(() => __importStar(require('child_process')));
            const { promisify } = await Promise.resolve().then(() => __importStar(require('util')));
            const execFilePromise = promisify(execFile);
            const { stdout } = await execFilePromise(ytdlpPath, [`ytsearch${limit}:${query}`, '--print', '%(id)s|||%(title)s', '--flat-playlist', '--no-warnings'], { timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
            for (const line of stdout.trim().split('\n')) {
                if (results.length >= limit)
                    break;
                if (!line.includes('|||'))
                    continue;
                const [id, title] = line.split('|||');
                if (id && /^[a-zA-Z0-9_-]{11}$/.test(id)) {
                    results.push({
                        title: (title || query).trim(),
                        url: `https://www.youtube.com/watch?v=${id}`,
                        videoId: id,
                    });
                }
            }
        }
        catch (e) {
            logger_1.logger.warn(`yt-dlp music search failed: ${e.message}`);
        }
        return results;
    },
    // BUG-054 Fix: Cached async yt-dlp path resolver
    cachedYtDlpPath: null,
    ytDlpChecked: false,
    async getYtDlpPathAsync() {
        if (this.ytDlpChecked)
            return this.cachedYtDlpPath;
        const possiblePaths = [
            path_1.default.join(process.cwd(), 'yt-dlp.exe'),
            path_1.default.join(process.cwd(), 'yt-dlp'),
            'yt-dlp',
        ];
        for (const p of possiblePaths) {
            try {
                if (p === 'yt-dlp') {
                    await execPromise('yt-dlp --version');
                    this.cachedYtDlpPath = 'yt-dlp';
                    break;
                }
                if (fs_1.default.existsSync(p)) {
                    this.cachedYtDlpPath = p;
                    break;
                }
            }
            catch { }
        }
        this.ytDlpChecked = true;
        return this.cachedYtDlpPath;
    },
    getYtDlpPath() {
        if (this.ytDlpChecked)
            return this.cachedYtDlpPath;
        // Fallback if called synchronously
        return null;
    },
    /**
     * Clean up old temp files
     */
    async cleanup() {
        try {
            if (!fs_1.default.existsSync(TEMP_DIR))
                return;
            const files = fs_1.default.readdirSync(TEMP_DIR);
            const now = Date.now();
            let cleaned = 0;
            for (const file of files) {
                const filePath = path_1.default.join(TEMP_DIR, file);
                try {
                    const stat = fs_1.default.statSync(filePath);
                    if (now - stat.mtimeMs > 3600000) {
                        fs_1.default.unlinkSync(filePath);
                        cleaned++;
                    }
                }
                catch { }
            }
            if (cleaned > 0)
                logger_1.logger.info(`🧹 MusicService: ${cleaned} temp files cleaned.`);
        }
        catch { }
    }
};
