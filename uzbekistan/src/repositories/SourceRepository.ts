import { getSupabase } from "./BaseRepository";
import { logger } from "../utils/logger";

export const SourceRepository = {
  async getByUser(userId: number) {
    const { data, error } = await getSupabase().from('sources').select('*').eq('user_id', userId);
    if (error) logger.error(`getUserSources error: ${error.message}`);
    return data || [];
  },

  async getAll() {
    const { data, error } = await getSupabase().from('sources').select('*');
    if (error) logger.error(`getAllSources error: ${error.message}`);
    return data || [];
  },

  async add(userId: number, name: string, url: string, lang: string): Promise<boolean> {
    const { error } = await getSupabase().from('sources').insert({ user_id: userId, name, url, lang });
    if (error) { logger.error(`addSource error: ${error.message}`); return false; }
    return true;
  },

  async remove(userId: number, sourceId: number) {
    const { error } = await getSupabase().from('sources').delete().eq('id', sourceId).eq('user_id', userId);
    if (error) logger.error(`removeSource error: ${error.message}`);
  },
};
