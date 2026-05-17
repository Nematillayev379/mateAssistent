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
                logger_1.logger.info(`Downloading YouTube video with yt-dlp: ${(0, logger_1.sanitizeLogInput)(url)}`);
                // BUG-047 Fix: Use execFile to avoid hanging processes when shell ignores SIGTERM on timeout
                const { execFile } = await Promise.resolve().then(() => __importStar(require('child_process')));
                const execFilePromise = (0, util_1.promisify)(execFile);
                await execFilePromise(ytdlpPath, [
                    '-f', 'best[ext=mp4][filesize<50M]/best[filesize<50M]/best',
                    '-o', filePath,
                    url
                ], { timeout: 60000 });
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
                    const { execFile } = await Promise.resolve().then(() => __importStar(require('child_process')));
                    const execFilePromise = (0, util_1.promisify)(execFile);
                    await execFilePromise('yt-dlp', ['--version'], { timeout: 5000 });
                    ytdlpCmd = 'yt-dlp';
                }
                catch { }
            }
            if (ytdlpCmd) {
                const { execFile } = await Promise.resolve().then(() => __importStar(require('child_process')));
                const execFilePromise = (0, util_1.promisify)(execFile);
                await execFilePromise(ytdlpCmd, [
                    '-f', 'best',
                    '-o', filePath,
                    url
                ], { timeout: 30000 });
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
    async getCobaltMedia(url, opts) {
        const audioOnly = !!opts?.audioOnly;
        const instances = [
            'https://api.cobalt.tools',
            'https://cobalt.api.timelessnesses.me',
            'https://cobalt.canine.tools',
            'https://cobalt.meowing.de',
            'https://cobalt.kittycat.boo',
            'https://dl.woof.monster',
        ];
        const fetchFromInstance = async (base) => {
            try {
                const res = await axios_1.default.post(`${base}/`, {
                    url,
                    videoQuality: '720',
                    filenameStyle: 'basic',
                    downloadMode: audioOnly ? 'audio' : 'auto',
                    isAudioOnly: audioOnly,
                    audioFormat: 'mp3',
                }, {
                    headers: {
                        Accept: 'application/json',
                        'Content-Type': 'application/json',
                        Origin: 'https://cobalt.tools',
                    },
                    timeout: 25000,
                });
                if (res.data?.url)
                    return res.data.url;
                if (res.data?.status === 'stream' && res.data?.url)
                    return res.data.url;
                if (res.data?.status === 'redirect' && res.data?.url)
                    return res.data.url;
                if (res.data?.status === 'picker' && res.data.picker?.length > 0) {
                    return res.data.picker[0].url;
                }
                throw new Error('No URL in response');
            }
            catch {
                const res = await axios_1.default.post(`${base}/api/json`, {
                    url,
                    vQuality: '720',
                    filenamePattern: 'basic',
                    isAudioOnly: audioOnly,
                }, {
                    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
                    timeout: 20000,
                });
                if (res.data?.url)
                    return res.data.url;
                if (res.data?.status === 'stream' && res.data?.url)
                    return res.data.url;
                if (res.data?.status === 'picker' && res.data.picker?.length > 0) {
                    return res.data.picker[0].url;
                }
                throw new Error('No URL in response');
            }
        };
        try {
            const bestUrl = await Promise.any(instances.map(base => fetchFromInstance(base)));
            return bestUrl;
        }
        catch {
            logger_1.logger.warn(`All Cobalt instances failed for: ${(0, logger_1.sanitizeLogInput)(url)}`);
            return null;
        }
    },
    /** Clean up temp files older than 1 hour */
    // BUG-048 Fix: Use async operations to prevent blocking the Node.js event loop
    async cleanup() {
        try {
            if (!fs_1.default.existsSync(TEMP_DIR))
                return;
            const files = await fs_1.default.promises.readdir(TEMP_DIR);
            const now = Date.now();
            for (const file of files) {
                const filePath = path_1.default.join(TEMP_DIR, file);
                try {
                    const stat = await fs_1.default.promises.stat(filePath);
                    if (now - stat.mtimeMs > 3600000) {
                        await fs_1.default.promises.unlink(filePath);
                    }
                }
                catch { }
            }
        }
        catch (e) { }
    }
};
