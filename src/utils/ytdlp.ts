import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec, execFile } from 'child_process';
import { logger } from './logger';

const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);

let cachedYtDlpPath: string | null = null;
let cachedYtDlpCommand: { command: string; args: string[] } | null = null;
let ytDlpChecked = false;

import https from 'https';

function downloadFile(url: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    function performGet(currentUrl: string) {
      https.get(currentUrl, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          performGet(response.headers.location as string);
        } else if (response.statusCode === 200) {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            resolve();
          });
        } else {
          reject(new Error(`Failed to download: ${response.statusCode}`));
        }
      }).on('error', (err) => {
        file.close();
        if (fs.existsSync(destination)) fs.unlinkSync(destination);
        reject(err);
      });
    }
    performGet(url);
  });
}

/** Resolve yt-dlp binary (Render/Linux, Docker, Windows, postinstall). */
export async function resolveYtDlpPath(): Promise<string | null> {
  const command = await resolveYtDlpCommand();
  if (!command) return null;
  return command.args.length ? [command.command, ...command.args].join(' ') : command.command;
}

/** Resolve yt-dlp as an executable plus base args for safe spawn/execFile usage. */
export async function resolveYtDlpCommand(): Promise<{ command: string; args: string[] } | null> {
  if (ytDlpChecked) return cachedYtDlpCommand;

  const candidates = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(__dirname, '..', '..', 'yt-dlp'),
    path.join(__dirname, '..', '..', 'yt-dlp.exe'),
    path.join(process.cwd(), 'yt-dlp'),
    path.join(process.cwd(), 'yt-dlp.exe'),
    ...(process.platform === 'win32' ? [
      path.join(process.env.USERPROFILE || 'C:', 'yt-dlp.exe'),
      path.join(process.env.LOCALAPPDATA || process.env.USERPROFILE || 'C:', 'Programs', 'yt-dlp', 'yt-dlp.exe'),
      path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'yt-dlp', 'yt-dlp.exe'),
    ] : []),
    'yt-dlp',
  ];

  for (const p of candidates) {
    try {
      if (p === 'yt-dlp' || fs.existsSync(p)) {
        if (process.platform !== 'win32' && p !== 'yt-dlp') {
          try {
            fs.chmodSync(p, '755');
          } catch (e: any) { logger.warn(`Failed to chmod yt-dlp: ${e?.message || 'unknown error'}`); }
        }
        await execFilePromise(p, ['--version'], { timeout: 8000 });
        cachedYtDlpPath = p;
        cachedYtDlpCommand = { command: p, args: [] };
        break;
      }
    } catch {
      /* try next */
    }
  }

  // Self-healing fallback: Download Python zipapp version if all else fails
  if (!cachedYtDlpPath && process.platform !== 'win32') {
    try {
      const fallbackPath = path.join(process.cwd(), 'yt-dlp-python');
      if (!fs.existsSync(fallbackPath)) {
        await downloadFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp', fallbackPath);
        fs.chmodSync(fallbackPath, '755');
      }
      
      try {
        await execFilePromise('python3', [fallbackPath, '--version'], { timeout: 10000 });
        cachedYtDlpPath = fallbackPath;
        cachedYtDlpCommand = { command: 'python3', args: [fallbackPath] };
      } catch {
        await execFilePromise(fallbackPath, ['--version'], { timeout: 10000 });
        cachedYtDlpPath = fallbackPath;
        cachedYtDlpCommand = { command: fallbackPath, args: [] };
      }
    } catch {
      // Ignored
    }
  }

  // Windows fallback: find yt-dlp via `where`, then Python module
  if (!cachedYtDlpPath && process.platform === 'win32') {
    try {
      const { stdout } = await execPromise('where yt-dlp 2>nul');
      const wherePath = stdout.split('\n')[0].trim();
      if (wherePath && fs.existsSync(wherePath)) {
        await execFilePromise(wherePath, ['--version'], { timeout: 8000 });
        cachedYtDlpPath = wherePath;
        cachedYtDlpCommand = { command: wherePath, args: [] };
      }
    } catch {
      const pythonLaunchers: Array<{ cmd: string; args: string[] }> = [
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
        } catch {
          // try next launcher
        }
      }
    }
  }

  if (!cachedYtDlpPath) {
    logger.warn('yt-dlp not found after checking all candidates. Install with: npm install yt-dlp or winget install yt-dlp');
  }
  ytDlpChecked = true;
  return cachedYtDlpCommand;
}

export function findNewestFile(dir: string, prefix: string, ext?: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && (!ext || f.endsWith(ext)))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? path.join(dir, files[0].name) : null;
}
