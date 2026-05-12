"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.YoutubeService = void 0;
exports.downloadYouTube = downloadYouTube;
const axios_1 = __importDefault(require("axios"));
const cheerio_1 = __importDefault(require("cheerio"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const child_process_1 = require("child_process");
const logger_1 = require("../utils/logger");
const execPromise = (0, util_1.promisify)(child_process_1.exec);
// Use a dedicated temp directory (not process.cwd()/tmp which may not exist)
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
            const $ = cheerio_1.default.load(res.data, { xmlMode: true });
            const latestEntry = $('entry').first();
            if (!latestEntry.length)
                return null;
            return {
                id: latestEntry.find('yt\\:videoId').text() || latestEntry.find('videoId').text(),
                title: latestEntry.find('title').text(),
                url: latestEntry.find('link').attr('href'),
                published: latestEntry.find('published').text()
            };
        }
        catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            logger_1.logger.error(`YoutubeService error: ${errorMessage}`);
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
        // For @handles, we need to fetch page and find is channelId
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
            const $ = cheerio_1.default.load(res.data);
            const results = [];
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
                    }
                    catch (e) {
                        logger_1.logger.warn(`ytInitialData parse failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
                    }
                }
            }
            return results;
        }
        catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            logger_1.logger.error(`YouTube search error: ${errorMessage}`);
            return [];
        }
    },
};
/**
 * Download YouTube video or audio using yt-dlp (primary) or ytdl-core (fallback)
 * Fully wrapped in try/catch to prevent process crashes
 */
async function downloadYouTube(urlParam, typeParam) {
    // Ensure temp directory exists
    if (!fs_1.default.existsSync(TEMP_DIR))
        fs_1.default.mkdirSync(TEMP_DIR, { recursive: true });
    const ext = typeParam === 'audio' ? 'm4a' : 'mp4';
    const filePath = path_1.default.join(TEMP_DIR, `yt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`);
    const maxBytes = (parseInt(process.env.YOUTUBE_MAX_SIZE_MB || '50') * 1024 * 1024);
    // Strategy 1: yt-dlp (most reliable)
    const ytdlpPath = getYtDlpPath();
    if (ytdlpPath) {
        try {
            logger_1.logger.info(`Downloading YouTube ${typeParam} with yt-dlp: ${urlParam}`);
            let command;
            if (typeParam === 'audio') {
                command = `"${ytdlpPath}" -f "bestaudio[ext=m4a]" -o "${filePath}" "${urlParam}" --no-warnings --no-playlist --max-filesize 49M`;
            }
            else {
                command = `"${ytdlpPath}" -f "best[ext=mp4][filesize<50M]/best[filesize<50M]/best" -o "${filePath}" "${urlParam}" --no-warnings --no-playlist`;
            }
            await execPromise(command, { timeout: 120000 });
            // yt-dlp may create a file with a slightly different name
            if (fs_1.default.existsSync(filePath)) {
                const stats = fs_1.default.statSync(filePath);
                if (stats.size > 0 && stats.size <= maxBytes) {
                    logger_1.logger.info(`YouTube ${typeParam} saved: ${filePath} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
                    return filePath;
                }
                // File too big
                if (stats.size > maxBytes) {
                    fs_1.default.unlinkSync(filePath);
                    throw new Error(`Fayl hajmi ${(stats.size / 1024 / 1024).toFixed(1)}MB - chegaradan oshib ketdi`);
                }
            }
            // Check for yt-dlp generated file names (sometimes adds suffix)
            const altNames = [
                filePath.replace(/\.[a-zA-Z0-9]+$/, '') + '.webm',
                filePath.replace(/\.[a-zA-Z0-9]+$/, '') + '.opus',
            ];
            for (const alt of altNames) {
                if (fs_1.default.existsSync(alt)) {
                    const stats = fs_1.default.statSync(alt);
                    if (stats.size > 0 && stats.size <= maxBytes) {
                        logger_1.logger.info(`YouTube ${typeParam} saved: ${alt} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
                        return alt;
                    }
                }
            }
        }
        catch (e) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            logger_1.logger.warn(`yt-dlp download failed: ${errorMessage.slice(0, 150)}`);
            // Cleanup on failure
            try {
                if (fs_1.default.existsSync(filePath))
                    fs_1.default.unlinkSync(filePath);
            }
            catch { }
        }
    }
    // Strategy 2: @distube/ytdl-core (fallback)
    try {
        logger_1.logger.info(`Trying ytdl-core for: ${urlParam}`);
        const ytdl = require('@distube/ytdl-core');
        const info = await ytdl.getInfo(urlParam);
        const title = info.videoDetails.title.replace(/[<>:"/\\|?*]+/g, '_');
        const fallbackPath = path_1.default.join(TEMP_DIR, `yt_${Date.now()}_${title.slice(0, 30)}.${ext}`);
        const stream = ytdl(urlParam, {
            quality: typeParam === 'audio' ? 'highestaudio' : 'highestvideo',
            filter: typeParam === 'audio' ? 'audioonly' : 'audioandvideo',
        });
        const write = fs_1.default.createWriteStream(fallbackPath);
        stream.pipe(write);
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Download timeout (120s)')), 120000);
            write.on('finish', () => { clearTimeout(timeout); resolve(); });
            write.on('error', (err) => { clearTimeout(timeout); reject(err); });
            stream.on('error', (err) => { clearTimeout(timeout); reject(err); });
        });
        const stats = fs_1.default.statSync(fallbackPath);
        if (stats.size > maxBytes) {
            fs_1.default.unlinkSync(fallbackPath);
            throw new Error(`Fayl hajmi ${(stats.size / 1024 / 1024).toFixed(1)}MB - chegaradan oshib ketdi`);
        }
        logger_1.logger.info(`YouTube ${typeParam} saved via ytdl-core: ${fallbackPath} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
        return fallbackPath;
    }
    catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        logger_1.logger.error(`ytdl-core also failed: ${errorMessage}`);
        try {
            if (fs_1.default.existsSync(filePath))
                fs_1.default.unlinkSync(filePath);
        }
        catch { }
    }
    // Strategy 3: Cobalt API
    try {
        logger_1.logger.info(`Trying Cobalt API for: ${urlParam}`);
        const { DownloaderService } = require('./downloader');
        const cobaltUrl = await DownloaderService.getCobaltMedia(urlParam);
        if (cobaltUrl) {
            // Download to file
            const cobaltPath = path_1.default.join(TEMP_DIR, `yt_cobalt_${Date.now()}.${ext}`);
            const writer = fs_1.default.createWriteStream(cobaltPath);
            const response = await axios_1.default.get(cobaltUrl, { responseType: 'stream', timeout: 60000 });
            response.data.pipe(writer);
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Cobalt download timeout')), 60000);
                writer.on('finish', () => { clearTimeout(timeout); resolve(); });
                writer.on('error', (err) => { clearTimeout(timeout); reject(err); });
            });
            if (fs_1.default.existsSync(cobaltPath)) {
                const stats = fs_1.default.statSync(cobaltPath);
                if (stats.size > 0) {
                    logger_1.logger.info(`YouTube ${typeParam} saved via Cobalt: ${cobaltPath} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
                    return cobaltPath;
                }
            }
        }
    }
    catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        logger_1.logger.error(`Cobalt also failed: ${errorMessage}`);
    }
    throw new Error('Barcha yuklash usullari ishlamadi. Iltimos, boshqa havola bilan urinib ko\'ring.');
}
/**
 * Find yt-dlp binary
 */
function getYtDlpPath() {
    const possiblePaths = [
        path_1.default.join(process.cwd(), 'yt-dlp.exe'),
        path_1.default.join(process.cwd(), 'yt-dlp'),
        'yt-dlp'
    ];
    logger_1.logger.info(`🔍 Checking for yt-dlp in: ${JSON.stringify(possiblePaths)}`);
    for (const p of possiblePaths) {
        if (p === 'yt-dlp') {
            try {
                (0, child_process_1.execSync)('yt-dlp --version', { timeout: 5000, stdio: 'ignore' });
                logger_1.logger.info(`✅ Found yt-dlp in system PATH`);
                return 'yt-dlp';
            }
            catch {
                continue;
            }
        }
        if (fs_1.default.existsSync(p)) {
            logger_1.logger.info(`✅ Found yt-dlp at: ${p}`);
            return p;
        }
    }
    logger_1.logger.warn(`❌ yt-dlp NOT found in any of the expected paths.`);
    return null;
}
