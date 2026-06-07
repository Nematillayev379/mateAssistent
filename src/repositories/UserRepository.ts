import { getSupabase } from "./BaseRepository";
import { WorkspaceRepository } from "./WorkspaceRepository";
import { logger } from "../utils/logger";

export const UserRepository = {
  async get(telegramId: number) {
    const { data, error } = await getSupabase().from('users').select('*').eq('telegram_id', telegramId).single();
    if (error && error.code !== 'PGRST116') logger.error(`getUser error: ${error.message}`);
    return data;
  },

  async getAll() {
    const { data, error } = await getSupabase().from('users').select('*');
    if (error) logger.error(`getAllUsers error: ${error.message}`);
    return data || [];
  },

  async getActive() {
    const { data, error } = await getSupabase()
      .from('users')
      .select('*')
      .or('is_active.eq.1,is_active.is.null')
      .not('target_channel', 'is', null)
      .eq('is_approved', 1);
    if (error) logger.error(`getActiveUsers error: ${error.message}`);
    return (data || []).filter((u: Record<string, unknown>) => typeof u.target_channel === 'string' && u.target_channel.trim() !== '');
  },

  async upsert(telegramId: number, isOwner = 0, username?: string, firstName?: string) {
    const existing = await this.get(telegramId);

    if (existing) {
      const updates: Record<string, unknown> = {
        username: username || existing.username,
        first_name: firstName || existing.first_name,
        is_active: 1,
      };
      if (isOwner === 1) {
        updates.role = 'owner';
        updates.is_owner = 1;
      }
      const { data, error } = await getSupabase().from('users').update(updates).eq('telegram_id', telegramId).select().single();
      if (error) { logger.error(`upsertUser update error: ${error.message}`); return existing; }
      return data;
    }

    const insertData: Record<string, unknown> = {
      telegram_id: telegramId, is_owner: isOwner, is_active: 1, is_approved: 1,
      role: isOwner === 1 ? 'owner' : 'user', interval_minutes: 15, language: 'uz',
      username: username || null, first_name: firstName || null,
    };
    const { data, error } = await getSupabase().from('users').insert(insertData).select().single();
    if (error) { logger.error(`upsertUser insert error: ${error.message}`); return null; }
    return data;
  },

  async update(telegramId: number, updates: Record<string, unknown>): Promise<boolean> {
    const safe = { ...updates };
    if (typeof safe.target_channel === 'string') {
      let ch = String(safe.target_channel || '').trim();
      if (ch.includes('t.me/')) { const parts = ch.split('t.me/'); const h = parts[parts.length - 1].split('/')[0].trim(); if (h) ch = `@${h}`; }
      if (!ch.startsWith('@') && !ch.startsWith('-100') && /^[a-zA-Z0-9_]{5,32}$/.test(ch)) ch = `@${ch}`;
      safe.target_channel = ch;
    }
    const { error } = await getSupabase().from('users').update(safe).eq('telegram_id', telegramId);
    if (error) { logger.error(`updateUser error: ${error.message}`); return false; }
    return true;
  },

  async getByReferralCode(code: string) {
    const { data } = await getSupabase().from('users').select('*').eq('referral_code', code.toUpperCase()).maybeSingle();
    return data;
  },

  async getForAdmin() {
    const { data, error } = await getSupabase().from('users').select('*').order('created_at', { ascending: false });
    if (error) { logger.error(`getUsersForAdmin error: ${error.message}`); return []; }
    return (data || []);
  },

  outputChannels(user: { target_channel?: string | null; extra_channels?: string }): string[] {
    const list: string[] = [];
    if (user?.target_channel) list.push(String(user.target_channel).trim());
    if (user?.extra_channels) {
      user.extra_channels.split(',').forEach((c: string) => { const t = c.trim(); if (t) list.push(t); });
    }
    return [...new Set(list)];
  },

  async getAllChannels(user: { target_channel?: string | null; extra_channels?: string; telegram_id?: number }): Promise<string[]> {
    const list = UserRepository.outputChannels(user);
    if (user?.telegram_id) {
      try {
        const userWs = await WorkspaceRepository.getByUser(user.telegram_id);
        for (const ws of userWs) {
          const channels = await WorkspaceRepository.getChannels(ws.id);
          for (const ch of channels) {
            if (ch.channel_id?.trim()) list.push(String(ch.channel_id).trim());
          }
        }
      } catch { /* workspace channels are best-effort extras */ }
    }
    return [...new Set(list)];
  },
};
