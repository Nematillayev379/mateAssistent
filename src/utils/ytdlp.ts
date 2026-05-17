import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execPromise = promisify(exec);

let cachedYtDlpPath: string | null = null;
let ytDlpChecked = false;

/** Resolve yt-dlp binary (Render/Linux, Docker, Windows, postinstall). */
export async function resolveYtDlpPath(): Promise<string | null> {
  if (ytDlpChecked) return cachedYtDlpPath;

  const candidates = [
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(process.cwd(), 'yt-dlp'),
    path.join(process.cwd(), 'yt-dlp.exe'),
    'yt-dlp',
  ];

  for (const p of candidates) {
    try {
      const cmd = p.includes(' ') || p.includes('\\') ? `"${p}"` : p;
      if (p === 'yt-dlp' || fs.existsSync(p)) {
        await execPromise(`${cmd} --version`, { timeout: 8000 });
        cachedYtDlpPath = p;
        break;
      }
    } catch {
      /* try next */
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
