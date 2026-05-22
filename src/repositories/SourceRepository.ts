import { getSupabase } from "./BaseRepository";

export const SourceRepository = {
  async getByUser(userId: number) {
    const { data, error } = await getSupabase().from('sources').select('*').eq('user_id', userId);
    if (error) console.error(`getUserSources error: ${error.message}`);
    return data || [];
  },

  async getAll() {
    const { data, error } = await getSupabase().from('sources').select('*');
    if (error) console.error(`getAllSources error: ${error.message}`);
    return data || [];
  },

  async add(userId: number, name: string, url: string, lang: string): Promise<boolean> {
    const { error } = await getSupabase().from('sources').insert({ user_id: userId, name, url, lang });
    if (error) { console.error(`addSource error: ${error.message}`); return false; }
    return true;
  },

  async remove(userId: number, sourceId: number) {
    const { error } = await getSupabase().from('sources').delete().eq('id', sourceId).eq('user_id', userId);
    if (error) console.error(`removeSource error: ${error.message}`);
  },
};
