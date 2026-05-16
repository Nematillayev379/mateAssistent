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
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
dotenv.config();
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
    // BUG-004 Fix: Persistent DASHBOARD_SECRET with strong warning
    DASHBOARD_SECRET: (() => {
        if (!process.env.DASHBOARD_SECRET) {
            console.warn('⚠️  DASHBOARD_SECRET muhit o\'zgaruvchisi o\'rnatilmagan! Dashboard linklari har restartda o\'zgaradi. .env fayliga DASHBOARD_SECRET=<uzun_sir_so\'z> qo\'shing.');
        }
        return process.env.DASHBOARD_SECRET || crypto.randomBytes(32).toString('hex');
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
// BUG-002 Fix: Added 'google' type support. BUG-006 Fix: Fixed dedup logic for empty strings
exports.KEY_POOL = [
    ...(process.env.GROQ_KEYS?.split(",").map(k => ({ key: k.trim(), type: "groq" })) || []),
    ...(process.env.GROQ_API_KEY && !(process.env.GROQ_KEYS && process.env.GROQ_KEYS.trim().length > 0)
        ? [{ key: process.env.GROQ_API_KEY.trim(), type: "groq" }]
        : []),
    ...(process.env.CEREBRAS_KEYS?.split(",").map(k => ({ key: k.trim(), type: "cerebras" })) || []),
    ...(process.env.OPENROUTER_KEYS?.split(",").map(k => ({ key: k.trim(), type: "openrouter" })) || []),
    ...(process.env.GEMINI_KEYS?.split(",").map(k => ({ key: k.trim(), type: "gemini" })) || []),
    ...(process.env.GOOGLE_KEYS?.split(",").map(k => ({ key: k.trim(), type: "google" })) || []),
    ...(process.env.OPENAI_KEYS?.split(",").map(k => ({ key: k.trim(), type: "openai" })) || []),
    ...(process.env.OPENAI_API_KEY && !(process.env.OPENAI_KEYS && process.env.OPENAI_KEYS.trim().length > 0)
        ? [{ key: process.env.OPENAI_API_KEY.trim(), type: "openai" }]
        : []),
].filter(k => k.key.length > 0);
