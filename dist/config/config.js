"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.KEY_POOL = exports.isOwnerId = exports.CONFIG = exports.MAX_TOKENS_BY_PROVIDER = void 0;
exports.parseKeyList = parseKeyList;
exports.buildKeyPoolFromEnv = buildKeyPoolFromEnv;
exports.countKeysByProvider = countKeysByProvider;
exports.getEnvKeySourceReport = getEnvKeySourceReport;
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
dotenv.config({ override: false }); // Kubernetes/Render env-vars win over local .env
// BUG-001 Fix: Provider-based max token limits
exports.MAX_TOKENS_BY_PROVIDER = {
    groq: 1500, // Groq models have smaller context limits
    cerebras: 2000,
    openrouter: 2000,
    gemini: 2000,
    openai: 2000,
    google: 2000,
};
exports.CONFIG = {
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "",
    MAX_TOKENS: 2000,
    TEMPERATURE: 0.6,
    WATCHER_CRON: "*/5 * * * *", // B-55 Fix: Every 5 min to reduce API load and rate limit issues
    TIMEZONE: "Asia/Tashkent",
    LOG_DIR: path.join(process.cwd(), "logs"),
    MAX_SEEN: 10000,
    OWNER_ID: process.env.OWNER_ID ? parseInt(process.env.OWNER_ID.trim(), 10) : null,
    DEDUPLICATION_PROMPT: "Siz tajribali yangiliklar muharririsiz. Vazifangiz: yangi xabar avvalroq kanalga chiqarilganmi yoki yo'qligini aniqlash.\n" +
        "MUHIM: So'zma-so'z o'xshashlikka emas, balki xabarning ASOSIY MAZMUNI, VOQEA VA SHAxslarga e'tibor bering.\n" +
        "QOIDALAR:\n" +
        "1. Agar yangi xabar avvalgi xabarlardan birining AYNI TAKRORI bo'lsa (bir xil voqea, bir xil asosiy tafsilotlar, yangi malumot yoq) -> DUPLICATE.\n" +
        "2. Agar mavzu bir xil bo'lsa-da (masalan, bir xil voqea haqida boshqa tafsilot, davomi, yuzaga kelgan yangi holat, munosabat) -> UNIQUE.\n" +
        "3. Agar voqea bir xil, lekin umuman boshqa nuqtai nazar yoki qo'shimcha muhim faktlar bo'lsa -> UNIQUE.\n" +
        "Xulosa qat'iy bo'lsin: 'DUPLICATE' yoki 'UNIQUE'.",
    // BUG-005 Fix: Added English and international ad keywords
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
    // BUG-004 Fix: Fail early if DASHBOARD_SECRET not set (required for persistent dashboard links)
    // IMPORTANT: Set DASHBOARD_SECRET in your .env file or Render Environment Variables.
    // This is your master password for the admin dashboard - keep it secret!
    // Generate one with: openssl rand -hex 32 (Linux/Mac) or generate a long random string
    DASHBOARD_SECRET: (() => {
        if (!process.env.DASHBOARD_SECRET) {
            console.error('❌ DASHBOARD_SECRET environment variable is REQUIRED! Dashboard links will not persist across restarts.');
            console.error('   Add DASHBOARD_SECRET=<your-secret> to your .env file');
            throw new Error('DASHBOARD_SECRET is required - see errors above');
        }
        return process.env.DASHBOARD_SECRET;
    })(),
    REDIS_URL: process.env.REDIS_URL || ""
};
if (!process.env.OWNER_ID) {
    console.warn('⚠️  OWNER_ID muhit o\'zgaruvchisi o\'rnatilmagan! Owner huquqlari faqat bu sozlamalar bilan ishlaydi.');
}
const isOwnerId = (id) => {
    if (exports.CONFIG.OWNER_ID == null || id == null)
        return false;
    return String(id).trim() === String(exports.CONFIG.OWNER_ID).trim();
};
exports.isOwnerId = isOwnerId;
/** Parse comma-separated keys (Render default) or newline/semicolon lists. */
function parseKeyList(raw) {
    if (!raw?.trim())
        return [];
    const cleaned = raw.replace(/^\uFEFF/, '').trim();
    // Whole value wrapped in quotes: "key1,key2,key3"
    const unwrapped = (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
        (cleaned.startsWith("'") && cleaned.endsWith("'"))
        ? cleaned.slice(1, -1)
        : cleaned;
    return unwrapped
        .split(/[,;\n\r]+/)
        .map((k) => k.trim().replace(/^["']+|["']+$/g, ''))
        .filter((k) => k.length >= 8);
}
function collectProviderKeys(envPrefix, type, singleEnvNames) {
    const found = [];
    const bulk = process.env[`${envPrefix}_KEYS`];
    for (const k of parseKeyList(bulk)) {
        found.push({ key: k, type });
    }
    for (const name of singleEnvNames) {
        const v = process.env[name];
        if (!v?.trim())
            continue;
        // Some users put comma-separated list in GROQ_API_KEY instead of GROQ_KEYS
        if (v.includes(',') || v.includes('\n')) {
            for (const k of parseKeyList(v))
                found.push({ key: k, type });
        }
        else {
            const single = v.trim().replace(/^["']+|["']+$/g, '');
            if (single.length >= 8)
                found.push({ key: single, type });
        }
    }
    // GROQ_KEY_1, GEMINI_KEY_2, GROQ_01, etc.
    const prefixUpper = envPrefix.toUpperCase();
    for (const [name, value] of Object.entries(process.env)) {
        if (!value?.trim())
            continue;
        const upper = name.toUpperCase();
        if (upper.startsWith(`${prefixUpper}_`) &&
            (/_KEY_\d+$/i.test(upper) || /^[A-Z]+_\d+$/i.test(upper) || /_API_KEY_\d+$/i.test(upper))) {
            const cleaned = value.trim().replace(/^["']|["']$/g, '');
            if (cleaned.length >= 8)
                found.push({ key: cleaned, type });
        }
    }
    return found;
}
/** Build AI key pool from environment (supports 20+ keys, newlines, indexed vars). */
function buildKeyPoolFromEnv() {
    const all = [
        ...collectProviderKeys('GROQ', 'groq', ['GROQ_API_KEY']),
        ...collectProviderKeys('GEMINI', 'gemini', []),
        ...collectProviderKeys('GOOGLE', 'google', []),
        ...collectProviderKeys('CEREBRAS', 'cerebras', []),
        ...collectProviderKeys('OPENROUTER', 'openrouter', []),
        ...collectProviderKeys('OPENAI', 'openai', ['OPENAI_API_KEY']),
    ];
    const seen = new Set();
    return all.filter((entry) => {
        if (seen.has(entry.key))
            return false;
        seen.add(entry.key);
        return true;
    });
}
function countKeysByProvider(pool) {
    const counts = {};
    for (const k of pool) {
        counts[k.type] = (counts[k.type] || 0) + 1;
    }
    return counts;
}
/** How many keys were read from each Render env var (for logs / admin, no secrets). */
function getEnvKeySourceReport() {
    const report = {};
    const track = (name, raw) => {
        const n = parseKeyList(raw).length;
        if (n > 0)
            report[name] = n;
    };
    track('GROQ_KEYS', process.env.GROQ_KEYS);
    track('GROQ_API_KEY', process.env.GROQ_API_KEY);
    track('GEMINI_KEYS', process.env.GEMINI_KEYS);
    track('GOOGLE_KEYS', process.env.GOOGLE_KEYS);
    track('CEREBRAS_KEYS', process.env.CEREBRAS_KEYS);
    track('OPENROUTER_KEYS', process.env.OPENROUTER_KEYS);
    track('OPENAI_KEYS', process.env.OPENAI_KEYS);
    track('OPENAI_API_KEY', process.env.OPENAI_API_KEY);
    return report;
}
exports.KEY_POOL = buildKeyPoolFromEnv();
