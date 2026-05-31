import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CONFIG } from "../config/config";
import { logger } from "../utils/logger";

let supabase: SupabaseClient;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = CONFIG.SUPABASE_URL;
    const key = CONFIG.SUPABASE_KEY;
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_KEY must be set in environment variables.');
    }
    supabase = createClient(url, key);
    logger.info('Supabase client initialized.');
  }
  return supabase;
}

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(String(url || '').trim());
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
     'fbclid', 'gclid', 'igshid', 'feature'].forEach((p) => parsed.searchParams.delete(p));
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString();
  } catch {
    return String(url || '').trim();
  }
}

export function normalizeTitle(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\[[^\]]+\]|\([^)]+\)/g, ' ')
    .replace(/\s+[|\-–—:]\s+.*$/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isLikelyDuplicate(titleA: string, titleB: string): boolean {
  const a = normalizeTitle(titleA);
  const b = normalizeTitle(titleB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length > 24 && b.includes(a)) return true;
  if (b.length > 24 && a.includes(b)) return true;
  const tokensA = [...new Set(a.split(' ').filter((t) => t.length > 2))];
  const tokensB = new Set(b.split(' ').filter((t) => t.length > 2));
  if (tokensA.length < 4 || tokensB.size < 4) return false;
  const common = tokensA.filter((t) => tokensB.has(t)).length;
  return common / Math.min(tokensA.length, tokensB.size) >= 0.75;
}
