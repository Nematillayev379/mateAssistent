"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveYtDlpPath = resolveYtDlpPath;
exports.resolveYtDlpCommand = resolveYtDlpCommand;
exports.findNewestFile = findNewestFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const child_process_1 = require("child_process");
const execPromise = (0, util_1.promisify)(child_process_1.exec);
const execFilePromise = (0, util_1.promisify)(child_process_1.execFile);
let cachedYtDlpPath = null;
let cachedYtDlpCommand = null;
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
    const command = await resolveYtDlpCommand();
    if (!command)
        return null;
    return command.args.length ? [command.command, ...command.args].join(' ') : command.command;
}
/** Resolve yt-dlp as an executable plus base args for safe spawn/execFile usage. */
async function resolveYtDlpCommand() {
    if (ytDlpChecked)
        return cachedYtDlpCommand;
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
            if (p === 'yt-dlp' || fs_1.default.existsSync(p)) {
                if (process.platform !== 'win32' && p !== 'yt-dlp') {
                    try {
                        fs_1.default.chmodSync(p, '755');
                    }
                    catch { }
                }
                await execFilePromise(p, ['--version'], { timeout: 8000 });
                cachedYtDlpPath = p;
                cachedYtDlpCommand = { command: p, args: [] };
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
                await execFilePromise('python3', [fallbackPath, '--version'], { timeout: 10000 });
                cachedYtDlpPath = fallbackPath;
                cachedYtDlpCommand = { command: 'python3', args: [fallbackPath] };
            }
            catch {
                await execFilePromise(fallbackPath, ['--version'], { timeout: 10000 });
                cachedYtDlpPath = fallbackPath;
                cachedYtDlpCommand = { command: fallbackPath, args: [] };
            }
        }
        catch {
            // Ignored
        }
    }
    // Windows fallback: use Python module if binary is blocked/missing
    if (!cachedYtDlpPath && process.platform === 'win32') {
        const pythonLaunchers = [
            { cmd: 'py', args: ['-m', 'yt_dlp'] },
            { cmd: 'python', args: ['-m', 'yt_dlp'] },
            { cmd: 'python3', args: ['-m', 'yt_dlp'] },
        ];
        for (const launcher of pythonLaunchers) {
            try {
                await execFilePromise(launcher.cmd, [...launcher.args, '--version'], { timeout: 8000 });
                cachedYtDlpPath = `${launcher.cmd} ${launcher.args.join(' ')}`;
                cachedYtDlpCommand = { command: launcher.cmd, args: launcher.args };
                break;
            }
            catch {
                // try next launcher
            }
        }
    }
    ytDlpChecked = true;
    return cachedYtDlpCommand;
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
