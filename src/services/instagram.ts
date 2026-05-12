import axios from 'axios';
import { logger } from '../utils/logger';

export const InstagramService = {
  /** Get latest post from username */
  async getLatestPost(username: string) {
    const cleanUsername = username.replace('@', '').trim();
    const proxyUrls = [
      `https://ddinstagram.com/u/${cleanUsername}`,
      `https://www.picuki.com/profile/${cleanUsername}`,
    ];

    for (const url of proxyUrls) {
      try {
        const res = await axios.get(url, { 
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 10000 
        });
        
        // Very basic parsing for demo - in production use a better scraper
        if (url.includes('ddinstagram')) {
           const match = res.data.match(/property="og:url"\s+content="([^"]+)"/);
           if (match) {
             const postUrl = match[1];
             const id = postUrl.split('/p/')[1]?.split('/')[0] || postUrl;
             return { id, url: postUrl, title: `Instagram post from @${cleanUsername}` };
           }
        } else if (url.includes('picuki')) {
           const match = res.data.match(/href="(\/media\/[^"]+)"/);
           if (match) {
             const id = match[1].split('/').pop();
             return { id, url: `https://www.instagram.com/p/${id}/`, title: `Instagram post from @${cleanUsername}` };
           }
        }
      } catch (e: any) {
        logger.warn(`Instagram scrape failed for ${url}: ${e.message}`);
      }
    }
    return null;
  }
};
