"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DownloaderService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const execPromise = (0, util_1.promisify)(child_process_1.exec);
const TEMP_DIR = path_1.default.join(os_1.default.tmpdir(), 'newsbot_media');
if (!fs_1.default.existsSync(TEMP_DIR))
    fs_1.default.mkdirSync(TEMP_DIR, { recursive: true });
exports.DownloaderService = {
    /** YouTube: Download video to temp file using yt-dlp */
    async getYouTubeVideo(url) {
        const filename = `yt_${Date.now()}.mp4`;
        const filePath = path_1.default.join(TEMP_DIR, filename);
        try {
            const ytdlpName = os_1.default.platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
            const ytdlpPath = path_1.default.join(process.cwd(), ytdlpName);
            if (fs_1.default.existsSync(ytdlpPath)) {
                logger_1.logger.info(`Downloading YouTube video with yt-dlp: ${url}`);
                // -o: output path, -f: format
                await execPromise(`"${ytdlpPath}" -f "best[ext=mp4][filesize<50M]/best[filesize<50M]/best" -o "${filePath}" "${url}"`, { timeout: 60000 });
                if (fs_1.default.existsSync(filePath))
                    return filePath;
            }
            // Fallback: Cobalt URL (less reliable but better than nothing)
            return this.getCobaltMedia(url);
        }
        catch (e) {
            logger_1.logger.error(`yt-dlp download failed: ${e.message}`);
            return this.getCobaltMedia(url);
        }
    },
    /** Instagram: Use multiple fallback strategies */
    async getInstagramVideo(url) {
        const filename = `ig_${Date.now()}.mp4`;
        const filePath = path_1.default.join(TEMP_DIR, filename);
        // Strategy 1: yt-dlp (Most reliable for downloading files)
        try {
            const ytdlpName = os_1.default.platform() === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
            const ytdlpPath = path_1.default.join(process.cwd(), ytdlpName);
            let ytdlpCmd = null;
            if (fs_1.default.existsSync(ytdlpPath)) {
                ytdlpCmd = `"${ytdlpPath}"`;
            }
            else {
                // Check system PATH
                try {
                    const { execSync } = require('child_process');
                    execSync('yt-dlp --version', { timeout: 5000, stdio: 'ignore' });
                    ytdlpCmd = 'yt-dlp';
                }
                catch { }
            }
            if (ytdlpCmd) {
                await execPromise(`${ytdlpCmd} -f "best" -o "${filePath}" "${url}"`, { timeout: 30000 });
                if (fs_1.default.existsSync(filePath))
                    return filePath;
            }
        }
        catch (e) { }
        // Strategy 2: ddinstagram proxy (Returns URL)
        try {
            const proxyUrl = url.replace(/instagram\.com/i, 'ddinstagram.com');
            const res = await axios_1.default.get(proxyUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: 10000
            });
            const match = res.data.match(/property="og:video"\s+content="([^"]+)"/);
            if (match)
                return match[1];
        }
        catch (e) { }
        // Strategy 3: Cobalt API
        return this.getCobaltMedia(url);
    },
    /** Cobalt API fallback for any social media */
    async getCobaltMedia(url) {
        const instances = [
            'https://api.cobalt.tools',
            'https://cobalt.liubquanti.click',
            'https://cobalt.canine.tools',
            'https://cobalt.meowing.de',
            'https://cobalt.kittycat.boo',
            'https://dl.woof.monster',
        ];
        for (const base of instances) {
            // Strategy 1: v10+ Schema (POST /)
            try {
                const res = await axios_1.default.post(`${base}/`, {
                    url,
                    videoQuality: "720",
                    filenameStyle: "basic",
                    downloadMode: "auto"
                }, {
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    },
                    timeout: 10000
                });
                if (res.data?.url)
                    return res.data.url;
                if (res.data?.status === 'stream')
                    return res.data.url;
                if (res.data?.status === 'picker' && res.data.picker?.length > 0)
                    return res.data.picker[0].url;
            }
            catch (e) {
                // Strategy 2: v7 Schema (POST /api/json)
                try {
                    const res = await axios_1.default.post(`${base}/api/json`, {
                        url,
                        vQuality: "720",
                        filenamePattern: "basic",
                        isAudioOnly: false
                    }, {
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                            'Referer': 'https://cobalt.tools/'
                        },
                        timeout: 8000
                    });
                    if (res.data?.url)
                        return res.data.url;
                    if (res.data?.status === 'stream')
                        return res.data.url;
                    if (res.data?.status === 'picker' && res.data.picker?.length > 0)
                        return res.data.picker[0].url;
                }
                catch (e2) { }
                logger_1.logger.warn(`Cobalt ${base} failed: ${e.message}`);
            }
        }
        return null;
    },
    /** Clean up temp files older than 1 hour */
    cleanup() {
        try {
            if (!fs_1.default.existsSync(TEMP_DIR))
                return;
            const files = fs_1.default.readdirSync(TEMP_DIR);
            const now = Date.now();
            for (const file of files) {
                const filePath = path_1.default.join(TEMP_DIR, file);
                const stat = fs_1.default.statSync(filePath);
                if (now - stat.mtimeMs > 3600000) {
                    fs_1.default.unlinkSync(filePath);
                }
            }
        }
        catch (e) { }
    }
};
