"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSupabase = getSupabase;
exports.normalizeUrl = normalizeUrl;
exports.normalizeTitle = normalizeTitle;
exports.isLikelyDuplicate = isLikelyDuplicate;
const supabase_js_1 = require("@supabase/supabase-js");
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
let supabase;
function getSupabase() {
    if (!supabase) {
        const url = config_1.CONFIG.SUPABASE_URL;
        const key = config_1.CONFIG.SUPABASE_KEY;
        if (!url || !key) {
            throw new Error('SUPABASE_URL and SUPABASE_KEY must be set in environment variables.');
        }
        supabase = (0, supabase_js_1.createClient)(url, key);
        logger_1.logger.info('Supabase client initialized.');
    }
    return supabase;
}
function normalizeUrl(url) {
    try {
        const parsed = new URL(String(url || '').trim());
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
            'fbclid', 'gclid', 'igshid', 'feature'].forEach((p) => parsed.searchParams.delete(p));
        parsed.hash = '';
        parsed.hostname = parsed.hostname.toLowerCase();
        parsed.pathname = parsed.pathname.replace(/\/+$/, '');
        return parsed.toString();
    }
    catch {
        return String(url || '').trim();
    }
}
function normalizeTitle(title) {
    return String(title || '')
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/\[[^\]]+\]|\([^)]+\)/g, ' ')
        .replace(/\s+[|\-–—:]\s+.*$/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function isLikelyDuplicate(titleA, titleB) {
    const a = normalizeTitle(titleA);
    const b = normalizeTitle(titleB);
    if (!a || !b)
        return false;
    if (a === b)
        return true;
    if (a.length > 24 && b.includes(a))
        return true;
    if (b.length > 24 && a.includes(b))
        return true;
    const tokensA = [...new Set(a.split(' ').filter((t) => t.length > 2))];
    const tokensB = new Set(b.split(' ').filter((t) => t.length > 2));
    if (tokensA.length < 4 || tokensB.size < 4)
        return false;
    const common = tokensA.filter((t) => tokensB.has(t)).length;
    return common / Math.min(tokensA.length, tokensB.size) >= 0.75;
}
