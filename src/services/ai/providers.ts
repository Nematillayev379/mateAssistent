import { OpenAI } from "openai";
import Groq from "groq-sdk";
import { CONFIG } from "../../config/config";
import type { AiKeyEntry } from "../../config/config";
import { logger } from "../../utils/logger";
import { groqClients, openaiClients, type GeminiResponse } from "./key-pool";

export const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct"
];

async function tryGroqModels(groq: Groq, system: string, user: string, maxTokens: number, exclude: string[] = []): Promise<string> {
  const candidates = GROQ_MODELS.filter(m => !exclude.includes(m));
  let lastErr: unknown = null;
  for (const model of candidates) {
    try {
      const res = await groq.chat.completions.create({
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        model,
        max_tokens: maxTokens,
      });
      const content = res.choices[0]?.message?.content ?? "";
      if (content) {
        if (model !== GROQ_MODELS[0]) logger.info(`[GROQ] Fallback model '${model}' ishladi.`);
        return content;
      }
    } catch (e: unknown) {
      lastErr = e;
      const msg = String((e instanceof Error ? e.message : e) || '');
      const status = (e as { status?: number })?.status;
      if (msg.includes('model') || msg.includes('decommission') || msg.includes('not found') || status === 400 || status === 404) {
        logger.warn(`[GROQ] Model '${model}' ishlamadi: ${msg.substring(0, 120)}. Keyingisiga o'tilmoqda...`);
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error("Barcha Groq modellari ishlamadi");
}

export async function requestAICompletion(currentKeyObj: AiKeyEntry, system: string, user: string, maxTokens: number, timeoutMs: number, excludeModels: string[] = []): Promise<string> {
  if (currentKeyObj.type === "groq") {
    let groq = groqClients.get(currentKeyObj.key);
    if (!groq) {
      groq = new Groq({ apiKey: currentKeyObj.key, timeout: timeoutMs });
      groqClients.set(currentKeyObj.key, groq);
    }
    return tryGroqModels(groq, system, user, maxTokens, excludeModels);
  }

  if (currentKeyObj.type === "gemini" || currentKeyObj.type === "google") {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${currentKeyObj.key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: CONFIG.TEMPERATURE }
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw Object.assign(new Error(`Gemini API error: ${response.statusText} ${errorBody}`), { status: response.status });
    }

    const data = await response.json().catch(() => ({})) as GeminiResponse;
    const candidates = data.candidates;
    return candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  }

  if (currentKeyObj.type === "openai") {
    let client = openaiClients.get(currentKeyObj.key);
    if (!client) {
      client = new OpenAI({ apiKey: currentKeyObj.key, timeout: timeoutMs });
      openaiClients.set(currentKeyObj.key, client);
    }
    const res = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content ?? "";
  }

  let baseURL: string;
  let model: string;
  switch (currentKeyObj.type) {
    case "cerebras":
      baseURL = "https://api.cerebras.ai/v1";
      model = "llama-3.1-70b";
      break;
    case "openrouter":
      baseURL = "https://openrouter.ai/api/v1";
      model = "google/gemini-2.0-flash-001";
      break;
    default:
      throw new Error(`Unsupported AI provider type: ${currentKeyObj.type}`);
  }

  const clientKey = `${baseURL}:${currentKeyObj.key}`;
  let client = openaiClients.get(clientKey);
  if (!client) {
    client = new OpenAI({
      apiKey: currentKeyObj.key,
      baseURL,
      timeout: timeoutMs
    });
    openaiClients.set(clientKey, client);
  }

  const res = await client.chat.completions.create({
    model,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_tokens: maxTokens,
  });
  return res.choices[0]?.message?.content ?? "";
}

export interface AiKeyEntryWithExclude extends AiKeyEntry {
  _excludeModels?: string[];
}
