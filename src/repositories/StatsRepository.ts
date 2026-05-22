import { getSupabase } from "./BaseRepository";

export const StatsRepository = {
  async increment(userId: number, field: 'total_posts' | 'total_duplicates') {
    const { error } = await getSupabase().rpc('increment_stat', { p_user_id: userId, p_field: field });
    if (error) console.error(`incrementStat rpc error: ${error.message}`);
  },

  async get(userId: number) {
    const { data } = await getSupabase().from('stats').select('*').eq('user_id', userId).maybeSingle();
    return data || { total_posts: 0, total_duplicates: 0 };
  },
};
