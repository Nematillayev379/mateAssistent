"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENV = void 0;
const zod_1 = require("zod");
const envSchema = zod_1.z.object({
    TELEGRAM_TOKEN: zod_1.z.string().min(1, "TELEGRAM_TOKEN or TELEGRAM_BOT_TOKEN is required"),
    TELEGRAM_BOT_TOKEN: zod_1.z.string().optional(),
    OWNER_ID: zod_1.z.coerce.number().int().positive().optional(),
    SUPABASE_URL: zod_1.z.string().url().optional().default(""),
    SUPABASE_KEY: zod_1.z.string().min(1).optional().default(""),
    DASHBOARD_SECRET: zod_1.z.string().optional().default(""),
    PUBLIC_URL: zod_1.z.string().optional().default(""),
    PORT: zod_1.z.coerce.number().int().positive().default(3000),
    REDIS_URL: zod_1.z.string().optional().default(""),
    REDIS_URLS: zod_1.z.string().optional().default(""),
    NODE_ENV: zod_1.z.enum(["development", "production"]).optional().default("production"),
    GROQ_KEYS: zod_1.z.string().optional(),
    GEMINI_KEYS: zod_1.z.string().optional(),
    CEREBRAS_KEYS: zod_1.z.string().optional(),
    OPENROUTER_KEYS: zod_1.z.string().optional(),
    OPENAI_KEYS: zod_1.z.string().optional(),
    TELEGRAM_CHANNEL_ID: zod_1.z.string().optional().default(""),
}).passthrough();
exports.ENV = envSchema.parse(process.env);
