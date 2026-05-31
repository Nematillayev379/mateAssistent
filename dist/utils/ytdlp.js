"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveYtDlpPath = resolveYtDlpPath;
exports.findNewestFile = findNewestFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const child_process_1 = require("child_process");
const execPromise = (0, util_1.promisify)(child_process_1.exec);
let cachedYtDlpPath = null;
let ytDlpChecked = false;
const https_1 = __importDefault(require("https"));
function downloadFile(url, destination) {
    return new Promise((resolve, reject) => {
        const file = fs_1.default.createWriteStream(destination);
        function performGet(currentUrl) {
            https_1.default.get(currentUrl, (response) => {
                if (response.statusCode === 302 || response.statusCode === 301) {
                    performGet(response.headers.location);
                }
                else if (response.statusCode === 200) {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve();
                    });
                }
                else {
                    reject(new Error(`Failed to download: ${response.statusCode}`));
                }
            }).on('error', (err) => {
                file.close();
                if (fs_1.default.existsSync(destination))
                    fs_1.default.unlinkSync(destination);
                reject(err);
            });
        }
        performGet(url);
    });
}
/** Resolve yt-dlp binary (Render/Linux, Docker, Windows, postinstall). */
async function resolveYtDlpPath() {
    if (ytDlpChecked)
        return cachedYtDlpPath;
    const candidates = [
        '/usr/local/bin/yt-dlp',
        '/usr/bin/yt-dlp',
        path_1.default.join(__dirname, '..', '..', 'yt-dlp'),
        path_1.default.join(__dirname, '..', '..', 'yt-dlp.exe'),
        path_1.default.join(process.cwd(), 'yt-dlp'),
        path_1.default.join(process.cwd(), 'yt-dlp.exe'),
        'yt-dlp',
    ];
    for (const p of candidates) {
        try {
            const cmd = p.includes(' ') || p.includes('\\') ? `"${p}"` : p;
            if (p === 'yt-dlp' || fs_1.default.existsSync(p)) {
                if (process.platform !== 'win32' && p !== 'yt-dlp') {
                    try {
                        fs_1.default.chmodSync(p, '755');
                    }
                    catch { }
                }
                await execPromise(`${cmd} --version`, { timeout: 8000 });
                cachedYtDlpPath = p;
                break;
            }
        }
        catch {
            /* try next */
        }
    }
    // Self-healing fallback: Download Python zipapp version if all else fails
    if (!cachedYtDlpPath && process.platform !== 'win32') {
        try {
            const fallbackPath = path_1.default.join(process.cwd(), 'yt-dlp-python');
            if (!fs_1.default.existsSync(fallbackPath)) {
                await downloadFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', fallbackPath);
                fs_1.default.chmodSync(fallbackPath, '755');
            }
            try {
                await execPromise(`python3 "${fallbackPath}" --version`, { timeout: 10000 });
                cachedYtDlpPath = `python3 "${fallbackPath}"`;
            }
            catch {
                await execPromise(`"${fallbackPath}" --version`, { timeout: 10000 });
                cachedYtDlpPath = fallbackPath;
            }
        }
        catch {
            // Ignored
        }
    }
    ytDlpChecked = true;
    return cachedYtDlpPath;
}
function findNewestFile(dir, prefix, ext) {
    if (!fs_1.default.existsSync(dir))
        return null;
    const files = fs_1.default.readdirSync(dir)
        .filter((f) => f.startsWith(prefix) && (!ext || f.endsWith(ext)))
        .map((f) => ({ name: f, mtime: fs_1.default.statSync(path_1.default.join(dir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    return files[0] ? path_1.default.join(dir, files[0].name) : null;
}
