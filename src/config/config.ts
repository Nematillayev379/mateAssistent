import * as dotenv from "dotenv";
import * as path from "path";
import * as crypto from "crypto";

dotenv.config();

export const CONFIG = {
  TELEGRAM_TOKEN:  process.env.TELEGRAM_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "",
  MAX_TOKENS:      2000,
  TEMPERATURE:     0.6,
  WATCHER_CRON:    "* * * * *", // Har minut ishlaydi, ichkarida foydalanuvchi intervali tekshiriladi
  TIMEZONE:        "Asia/Tashkent",
  LOG_DIR:         path.join(process.cwd(), "logs"),
  MAX_SEEN:        10000,
  OWNER_ID:        parseInt(process.env.OWNER_ID || "0", 10),
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
    "tushum", "chegirma", "1xbet", "melbet", "qimor"
  ],
  PUBLIC_URL: (process.env.PUBLIC_URL || "").replace(/\/$/, ""),
  SUPABASE_URL: process.env.SUPABASE_URL || "",
  SUPABASE_KEY: process.env.SUPABASE_KEY || "",
  DASHBOARD_SECRET: (() => {
    if (!process.env.DASHBOARD_SECRET) {
      console.warn('⚠️  DASHBOARD_SECRET muhit o\'zgaruvchisi o\'rnatilmagan! Dashboard linklari har restartda o\'zgaradi. .env fayliga DASHBOARD_SECRET=<uzun_sir_so\'z> qo\'shing.');
    }
    return process.env.DASHBOARD_SECRET || crypto.randomBytes(32).toString('hex');
  })(),
  REDIS_URL: process.env.REDIS_URL || ""
};

export const KEY_POOL: { key: string; type: "groq" | "cerebras" | "openrouter" | "gemini" | "openai" }[] = [
  ...(process.env.GROQ_KEYS?.split(",").map(k => ({ key: k.trim(), type: "groq" as const })) || []),
  ...(process.env.GROQ_API_KEY && !process.env.GROQ_KEYS
    ? [{ key: process.env.GROQ_API_KEY.trim(), type: "groq" as const }]
    : []),
  ...(process.env.CEREBRAS_KEYS?.split(",").map(k => ({ key: k.trim(), type: "cerebras" as const })) || []),
  ...(process.env.OPENROUTER_KEYS?.split(",").map(k => ({ key: k.trim(), type: "openrouter" as const })) || []),
  ...(process.env.GEMINI_KEYS?.split(",").map(k => ({ key: k.trim(), type: "gemini" as const })) || []),
  ...(process.env.OPENAI_KEYS?.split(",").map(k => ({ key: k.trim(), type: "openai" as const })) || []),
  ...(process.env.OPENAI_API_KEY && !process.env.OPENAI_KEYS
    ? [{ key: process.env.OPENAI_API_KEY.trim(), type: "openai" as const }]
    : []),
].filter(k => k.key.length > 0);

