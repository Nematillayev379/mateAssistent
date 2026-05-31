import * as dotenv from "dotenv";
import * as path from "path";
import * as crypto from "crypto";
import { SecretManager } from "../services/secret_manager";

dotenv.config({ override: false }); // Kubernetes/Render env-vars win over local .env
export const MAX_TOKENS_BY_PROVIDER: Record<string, number> = {
  groq: 1500,       // Groq models have smaller context limits
  cerebras: 2000,
  openrouter: 2000,
  gemini: 2000,
  openai: 2000,
  google: 2000,
};

export const CONFIG = {
  TELEGRAM_TOKEN: (() => {
    if (process.env.TELEGRAM_BOT_TOKEN && !process.env.TELEGRAM_TOKEN) {
      console.warn('TELEGRAM_BOT_TOKEN is deprecated. Use TELEGRAM_TOKEN instead.');
    }
    return SecretManager.get('TELEGRAM_TOKEN') || process.env.TELEGRAM_BOT_TOKEN || '';
  })(),
  MAX_TOKENS:      2000,
  TEMPERATURE:     0.6,
  WATCHER_CRON:    "*/5 * * * *", // B-55 Fix: Every 5 min to reduce API load and rate limit issues
  TIMEZONE:        "Asia/Tashkent",
  LOG_DIR:         path.join(process.cwd(), "logs"),
  MAX_SEEN:        10000,
  OWNER_ID:        process.env.OWNER_ID ? parseInt(process.env.OWNER_ID.trim(), 10) : null,
  DEDUPLICATION_PROMPT: 
    "Siz tajribali yangiliklar muharririsiz. Vazifangiz: yangi xabar avvalroq kanalga chiqarilganmi yoki yo'qligini aniqlash.\n" +
    "MUHIM: So'zma-so'z o'xshashlikka emas, balki xabarning ASOSIY MAZMUNI, VOQEA VA SHAxslarga e'tibor bering.\n" +
    "QOIDALAR:\n" +
    "1. Agar yangi xabar avvalgi xabarlardan birining AYNI TAKRORI bo'lsa (bir xil voqea, bir xil asosiy tafsilotlar, yangi malumot yoq) -> DUPLICATE.\n" +
    "2. Agar mavzu bir xil bo'lsa-da (masalan, bir xil voqea haqida boshqa tafsilot, davomi, yuzaga kelgan yangi holat, munosabat) -> UNIQUE.\n" +
    "3. Agar voqea bir xil, lekin umuman boshqa nuqtai nazar yoki qo'shimcha muhim faktlar bo'lsa -> UNIQUE.\n" +
    "Xulosa qat'iy bo'lsin: 'DUPLICATE' yoki 'UNIQUE'.",
  AD_KEYWORDS: [
    "reklama", "xarid", "aksiya", "shartlari", "yutuq", "muddati",
    "to'lov", "oyiga", "bonus", "sovg'a", "narxi", "sotiladi",
    "tushum", "chegirma", "1xbet", "melbet", "qimor",
    // English
    "buy now", "click here", "limited offer", "sponsored", "advertisement",
    "order now", "subscribe now", "free trial", "discount code", "promo code",
    // Russian
    "реклама", "купить", "скидка", "акция", "промокод"
  ],
  PUBLIC_URL: (process.env.PUBLIC_URL || "").replace(/\/$/, ""),
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_KEY: process.env.SUPABASE_KEY || "",
  TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID || "",
  // IMPORTANT: Set DASHBOARD_SECRET in your .env file or Render Environment Variables.
  // This is your master password for the admin dashboard - keep it secret!
  // Generate one with: openssl rand -hex 32 (Linux/Mac) or generate a long random string
  DASHBOARD_SECRET: process.env.DASHBOARD_SECRET || "",
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString('hex'),
  DEFAULT_REDIS_URL: process.env.DEFAULT_REDIS_URL || "",
  REDIS_URL: process.env.REDIS_URL || "",
  REDIS_URLS: process.env.REDIS_URLS || "",
  TON_WALLET: process.env.TON_WALLET || "",
  TONCENTER_KEY: process.env.TONCENTER_KEY || "",
  SECRET_BACKEND: (process.env.SECRET_BACKEND || "env") as "env" | "vault",
  API_KEY_SOURCES: ['groq', 'cerebras', 'openrouter', 'gemini', 'openai', 'google'] as const
};

if (!process.env.OWNER_ID) {
  console.warn('⚠️  OWNER_ID muhit o\'zgaruvchisi o\'rnatilmagan! Owner huquqlari faqat bu sozlamalar bilan ishlaydi.');
}

export const isOwnerId = (id?: number | string | null): boolean => {
  if (CONFIG.OWNER_ID == null || id == null) return false;
  return String(id).trim() === String(CONFIG.OWNER_ID).trim();
};

export type AiKeyType = 'groq' | 'cerebras' | 'openrouter' | 'gemini' | 'openai' | 'google';
export type AiKeyEntry = { key: string; type: AiKeyType };

/** Parse comma-separated keys (Render default) or newline/semicolon lists. */
export function parseKeyList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  const cleaned = raw.replace(/^\uFEFF/, '').trim();
  // Whole value wrapped in quotes: "key1,key2,key3"
  const unwrapped =
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
      ? cleaned.slice(1, -1)
      : cleaned;

  return unwrapped
    .split(/[,;\n\r]+/)
    .map((k) => k.trim().replace(/^["']+|["']+$/g, ''))
    .filter((k) => k.length >= 8);
}

function shouldUseDefaultRedisUrl(url: string): boolean {
  if (!url.trim()) return false;
  const normalized = url.trim().toLowerCase();
  if (!process.env.NODE_ENV || process.env.NODE_ENV === 'development') return true;
  return !normalized.includes('127.0.0.1') && !normalized.includes('localhost');
}

function collectProviderKeys(
  envPrefix: string,
  type: AiKeyType,
  singleEnvNames: string[]
): AiKeyEntry[] {
  const found: AiKeyEntry[] = [];
  const bulk = SecretManager.get(`${envPrefix}_KEYS`);
  for (const k of parseKeyList(bulk)) {
    found.push({ key: k, type });
  }
  for (const name of singleEnvNames) {
    const v = SecretManager.get(name);
    if (!v?.trim()) continue;
    // Some users put comma-separated list in GROQ_API_KEY instead of GROQ_KEYS
    if (v.includes(',') || v.includes('\n')) {
      for (const k of parseKeyList(v)) found.push({ key: k, type });
    } else {
      const single = v.trim().replace(/^["']+|["']+$/g, '');
      if (single.length >= 8) found.push({ key: single, type });
    }
  }
  // GROQ_KEY_1, GEMINI_KEY_2, GROQ_01, etc.
  const prefixUpper = envPrefix.toUpperCase();
  const allSecrets = SecretManager.getAllMatching(prefixUpper);
  for (const [name, value] of Object.entries(allSecrets)) {
    if (!value?.trim()) continue;
    const upper = name.toUpperCase();
    if (
      upper.startsWith(`${prefixUpper}_`) &&
      (/_KEY_\d+$/i.test(upper) || /^[A-Z]+_\d+$/i.test(upper) || /_API_KEY_\d+$/i.test(upper))
    ) {
      const cleaned = value.trim().replace(/^["']|["']$/g, '');
      if (cleaned.length >= 8) found.push({ key: cleaned, type });
    }
  }
  return found;
}

/** Build AI key pool from environment (supports 20+ keys, newlines, indexed vars). */
export function buildKeyPoolFromEnv(): AiKeyEntry[] {
  const all: AiKeyEntry[] = [
    ...collectProviderKeys('GROQ', 'groq', ['GROQ_API_KEY']),
    ...collectProviderKeys('GEMINI', 'gemini', []),
    ...collectProviderKeys('GOOGLE', 'google', []),
    ...collectProviderKeys('CEREBRAS', 'cerebras', []),
    ...collectProviderKeys('OPENROUTER', 'openrouter', []),
    ...collectProviderKeys('OPENAI', 'openai', ['OPENAI_API_KEY']),
  ];

  const seen = new Set<string>();
  return all.filter((entry) => {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
}

export function countKeysByProvider(pool: AiKeyEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const k of pool) {
    counts[k.type] = (counts[k.type] || 0) + 1;
  }
  return counts;
}

/** How many keys were read from each source (for logs / admin, no secrets). */
export function getEnvKeySourceReport(): Record<string, number> {
  return SecretManager.getKeyReport();
}

export const KEY_POOL: AiKeyEntry[] = buildKeyPoolFromEnv();
