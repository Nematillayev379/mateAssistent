import TelegramBot from "node-telegram-bot-api";

export interface BotCommand {
  pattern: RegExp;
  description: string;
  handler: (bot: TelegramBot, msg: TelegramBot.Message, match: RegExpExecArray | null) => Promise<void | any>;
}

export interface UserState {
  chatId: number;
  state: string;
  timestamp: number;
}

export interface TelegramUser {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  role: string | null;
  is_approved: number;
  is_active: number;
  is_owner: number;
  is_premium: number;
  target_channel: string | null;
  interval_minutes: number;
  last_post_time: number;
  extra_sources: number;
  custom_signature: string | null;
  referral_code: string | null;
  referral_count: number;
  premium_until: string | null;
  keywords: string;
  language: string;
  schedule_times: string;
  daily_digest: boolean;
  digest_time: string;
  digest_last_sent: string | null;
  has_seen_lang: boolean;
}

export interface NewsSource {
  id: number;
  user_id: number;
  name: string;
  url: string;
  lang: string;
}

export interface Article {
  title: string;
  content?: string;
  url: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  emoji?: string;
  source?: string;
  category?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  summary?: string;
  link?: string;
  pubDate?: string;
}

export interface ApiKey {
  key: string;
  type: 'groq' | 'cerebras' | 'openrouter' | 'gemini' | 'openai' | 'google';
}

export interface ReferralRecord {
  referrer_id: number;
  referred_id: number;
  created_at: string;
  reward_given: boolean;
  is_active: boolean;
}

export interface ScheduledPost {
  id: number;
  user_id: number;
  type: 'video' | 'audio' | 'text';
  content: {
    url?: string;
    text?: string;
    caption?: string;
    title?: string;
    imageUrl?: string;
  };
  scheduled_at: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  created_at?: string;
  sent_at?: string | null;
  error_message?: string | null;
}
