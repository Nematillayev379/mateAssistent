import { getSupabase, normalizeUrl, normalizeTitle, isLikelyDuplicate } from "./BaseRepository";
import { logger } from "../utils/logger";

export const NewsRepository = {
  async isSeen(userId: number, url: string, title: string): Promise<boolean> {
    if (await this.isSeenByUrl(userId, url)) return true;
    return this.isSeenByTitle(userId, title);
  },

  async isSeenByUrl(userId: number, url: string): Promise<boolean> {
    const nUrl = normalizeUrl(url);
    const { data, error } = await getSupabase().from('processed_news').select('id').eq('user_id', userId).eq('url', nUrl).limit(1);
    if (error) logger.error(`isSeen error: ${error.message}`);
    return !!(data && data.length > 0);
  },

  async isSeenByTitle(userId: number, title: string): Promise<boolean> {
    const { data, error } = await getSupabase()
      .from('processed_news').select('title').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(200);
    if (error) logger.error(`isSeenByTitle error: ${error.message}`);
    if (!data || data.length === 0) return false;
    return data.some((row: { title: string }) => isLikelyDuplicate(row.title, title));
  },

  async markSeen(userId: number, url: string, title: string) {
    const nUrl = normalizeUrl(url);
    const { error } = await getSupabase().from('processed_news').upsert(
      { user_id: userId, url: nUrl, title }, { onConflict: 'user_id,url' }
    );
    if (error) { logger.error(`markSeen error: ${error.message}`); throw error; }
  },

  async getLastTitles(userId: number, limit: number = 20): Promise<string[]> {
    const { data, error } = await getSupabase().from('processed_news').select('title').eq('user_id', userId).order('created_at', { ascending: false }).limit(limit);
    if (error) logger.error(`getLastTitles error: ${error.message}`);
    return (data || []).map(r => r.title);
  },

  async getRecentTitles(limit = 80): Promise<string[]> {
    const { data, error } = await getSupabase().from('processed_news').select('title').order('created_at', { ascending: false }).limit(limit);
    if (error) logger.error(`getRecentNewsTitles error: ${error.message}`);
    return (data || []).map((r: { title?: string }) => r?.title).filter(Boolean) as string[];
  },
};
