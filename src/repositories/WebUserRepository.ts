import { getSupabase } from "./BaseRepository";
import { logger } from "../utils/logger";

export type WebUserRecord = {
  telegram_id: number;
  email: string;
  password_hash: string;
  salt: string;
  approved: boolean;
  created_at?: string;
};

export const WebUserRepository = {
  async getByEmail(email: string): Promise<WebUserRecord | null> {
    const { data, error } = await getSupabase().from('web_users').select('*').eq('email', email).maybeSingle();
    if (error) {
      logger.error(`getWebUserByEmail error: ${error.message}`);
      return null;
    }
    return data as WebUserRecord | null;
  },

  async list() {
    const { data, error } = await getSupabase().from('web_users').select('email, telegram_id, approved, created_at').order('created_at', { ascending: false });
    if (error) {
      logger.error(`listWebUsers error: ${error.message}`);
      return [];
    }
    return data || [];
  },

  async create(record: WebUserRecord) {
    const { data, error } = await getSupabase().from('web_users').insert(record).select('*').single();
    if (error) {
      logger.error(`createWebUser error: ${error.message}`);
      return null;
    }
    return data as WebUserRecord;
  },
};
