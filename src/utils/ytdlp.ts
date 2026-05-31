import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execPromise = promisify(exec);

let cachedYtDlpPath: string | null = null;
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
  if (ytDlpChecked) return cachedYtDlpPath;

  const candidates = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(__dirname, '..', '..', 'yt-dlp'),
    path.join(__dirname, '..', '..', 'yt-dlp.exe'),
    path.join(process.cwd(), 'yt-dlp'),
    path.join(process.cwd(), 'yt-dlp.exe'),
    'yt-dlp',
  ];

  for (const p of candidates) {
    try {
      const cmd = p.includes(' ') || p.includes('\\') ? `"${p}"` : p;
      if (p === 'yt-dlp' || fs.existsSync(p)) {
        if (process.platform !== 'win32' && p !== 'yt-dlp') {
          try {
            fs.chmodSync(p, '755');
          } catch {}
        }
        await execPromise(`${cmd} --version`, { timeout: 8000 });
        cachedYtDlpPath = p;
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
        await execPromise(`python3 "${fallbackPath}" --version`, { timeout: 10000 });
        cachedYtDlpPath = `python3 "${fallbackPath}"`;
      } catch {
        await execPromise(`"${fallbackPath}" --version`, { timeout: 10000 });
        cachedYtDlpPath = fallbackPath;
      }
    } catch {
      // Ignored
    }
  }

  ytDlpChecked = true;
  return cachedYtDlpPath;
}

export function findNewestFile(dir: string, prefix: string, ext?: string): string | null {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && (!ext || f.endsWith(ext)))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return files[0] ? path.join(dir, files[0].name) : null;
}
