import axios from 'axios';
import { logger, sanitizeLogInput } from '../utils/logger';

interface InstagramParseResult {
  id: string;
  url: string;
  title: string;
}

interface InstagramProxy {
  name: string;
  url: (u: string) => string;
  parse: (html: string, username: string) => InstagramParseResult | null;
}

const PROXIES: InstagramProxy[] = [
  {
    name: 'ddinstagram',
    url: (u: string) => `https://ddinstagram.com/u/${u}`,
    parse: (html: string, username: string) => {
      const m = html.match(/property="og:url"\s+content="([^"]+)"/);
      if (!m) return null;
      const id = m[1].split('/p/')[1]?.split('/')[0] || m[1];
      return { id, url: m[1], title: `Instagram post from @${username}` };
    }
  },
  {
    name: 'picuki',
    url: (u: string) => `https://www.picuki.com/profile/${u}`,
    parse: (html: string, username: string) => {
      const m = html.match(/href="(\/media\/[^"]+)"/);
      if (!m) return null;
      const id = m[1].split('/').pop()!;
      return { id, url: `https://www.instagram.com/p/${id}/`, title: `Instagram post from @${username}` };
    }
  },
  {
    name: 'ddinstagram-direct',
    url: (u: string) => `https://ddinstagram.com/${u}`,
    parse: (html: string, username: string) => {
      const m = html.match(/property="og:url"\s+content="([^"]+)"/);
      if (!m) return null;
      const id = m[1].split('/p/')[1]?.split('/')[0] || m[1];
      return { id, url: m[1], title: `Instagram post from @${username}` };
    }
  }
];

export const InstagramService = {
  async getLatestPost(username: string): Promise<InstagramParseResult | null> {
    const clean = username.replace('@', '').trim();
    if (!clean) return null;

    for (const proxy of PROXIES) {
      try {
        const res = await axios.get<string>(proxy.url(clean), {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          timeout: 10000,
          responseType: 'text'
        });
        if (res.data && res.data.length > 200) {
          const result = proxy.parse(res.data, clean);
          if (result) return result;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(`Instagram proxy ${proxy.name} failed: ${sanitizeLogInput(msg)}`);
      }
    }
    return null;
  }
};
