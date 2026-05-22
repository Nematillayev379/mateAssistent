import { z } from "zod";

const envSchema = z.object({
  TELEGRAM_TOKEN: z.string().min(1, "TELEGRAM_TOKEN or TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  OWNER_ID: z.coerce.number().int().positive().optional(),
  SUPABASE_URL: z.string().url().optional().default(""),
  SUPABASE_KEY: z.string().min(1).optional().default(""),
  DASHBOARD_SECRET: z.string().optional().default(""),
  PUBLIC_URL: z.string().optional().default(""),
  PORT: z.coerce.number().int().positive().default(3000),
  REDIS_URL: z.string().optional().default(""),
  NODE_ENV: z.enum(["development", "production"]).optional().default("production"),
  GROQ_KEYS: z.string().optional(),
  GEMINI_KEYS: z.string().optional(),
  CEREBRAS_KEYS: z.string().optional(),
  OPENROUTER_KEYS: z.string().optional(),
  OPENAI_KEYS: z.string().optional(),
  TELEGRAM_CHANNEL_ID: z.string().optional().default(""),
}).passthrough();

export const ENV = envSchema.parse(process.env);
