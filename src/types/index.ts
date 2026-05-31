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

// BUG-007 Fix: Added 'role' field
// BUG-008 Fix: keywords documented as CSV string
// BUG-009 Fix: is_premium documented as number (0/1)
// BUG-010 Fix: is_active documented as number (0/1)
export interface TelegramUser {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  role: string | null;                // BUG-007: Was missing
  is_approved: number;
  is_active: number;                  // BUG-010: 0/1 numeric boolean
  is_owner: number;
  is_premium: number;                 // BUG-009: 0/1 numeric boolean
  target_channel: string | null;
  interval_minutes: number;
  last_post_time: number;
  extra_sources: number;
  custom_signature: string | null;
  referral_code: string | null;
  referral_count: number;
  premium_until: string | null;
  keywords: string;                   // BUG-008: CSV format string
  language: string;                   // BUG-134: Expanded to string for tr, de, etc.
  schedule_times: string;
  daily_digest: boolean;
  digest_time: string;
  digest_last_sent: string | null;    // BUG-145: Was missing
  has_seen_lang: boolean;             // BUG-081/146: Was missing
}

export interface NewsSource {
  id: number;
  user_id: number;
  name: string;
  url: string;
  lang: string;                       // BUG-134: Expanded to string
}

// BUG-011 Fix: emoji made optional with default
export interface Article {
  title: string;
  content: string;
  url: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  emoji?: string;                     // BUG-011: Made optional
  source: string;
  category?: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  summary?: string;
}

// BUG-002 Fix: Added 'google' to match KEY_POOL
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
