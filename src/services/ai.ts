import { OpenAI } from "openai";
import Groq from "groq-sdk";
import { EdgeTTS } from "@andresaya/edge-tts";
import crypto from 'crypto';
import axios from 'axios';
import { buildKeyPoolFromEnv, countKeysByProvider, CONFIG, MAX_TOKENS_BY_PROVIDER } from "../config/config";
import type { AiKeyEntry } from "../config/config";
import { logger } from "../utils/logger";
import { DBService } from "./database";

let globalKeyIndex = 0;
let embeddingKeyIndex = 0;
let activeKeys: AiKeyEntry[] = buildKeyPoolFromEnv();
const keyLock = { promise: Promise.resolve() as Promise<void> };
const scopedKeyIndexes = new Map<string, number>();

async function withKeyMutex<T>(fn: () => Promise<T>): Promise<T> {
  const prev = keyLock.promise;
  let nextResolve: () => void;
  keyLock.promise = new Promise<void>(resolve => { nextResolve = resolve; });
  await prev;
  try {
    return await fn();
  } finally {
    nextResolve!();
  }
}

// Client caching to save resources
const groqClients = new Map<string, Groq>();
const openaiClients = new Map<string, OpenAI>();

// Circuit Breaker for temporarily failed or rate-limited API keys
const blockedKeys = new Map<string, number>();

function getAvailableKeys(keys: AiKeyEntry[]): AiKeyEntry[] {
  const now = Date.now();
  const availableKeys = keys.filter((key) => {
    const blockedUntil = blockedKeys.get(key.key);
    return !blockedUntil || blockedUntil < now;
  });
  return availableKeys.length > 0 ? availableKeys : keys;
}

async function selectRotatingKey(keys: AiKeyEntry[], scope: 'global' | 'smm'): Promise<{ key: AiKeyEntry; idx: number }> {
  return withKeyMutex(async () => {
    const poolToUse = getAvailableKeys(keys);
    if (poolToUse.length === 0) {
      throw new Error('API kalitlar mavjud emas!');
    }

    if (scope === 'global') {
      const idx = globalKeyIndex % poolToUse.length;
      const key = poolToUse[idx];
      globalKeyIndex = (globalKeyIndex + 1) % poolToUse.length;
      return { key, idx };
    }

    const currentIndex = scopedKeyIndexes.get(scope) || 0;
    const idx = currentIndex % poolToUse.length;
    const key = poolToUse[idx];
    scopedKeyIndexes.set(scope, (currentIndex + 1) % poolToUse.length);
    return { key, idx };
  });
}

async function requestAICompletion(currentKeyObj: AiKeyEntry, system: string, user: string, maxTokens: number, timeoutMs: number): Promise<string> {
  if (currentKeyObj.type === "groq") {
    let groq = groqClients.get(currentKeyObj.key);
    if (!groq) {
      groq = new Groq({ apiKey: currentKeyObj.key, timeout: timeoutMs });
      groqClients.set(currentKeyObj.key, groq);
    }
    const res = await groq.chat.completions.create({
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      model: "llama-3.3-70b-versatile",
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content ?? "";
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

    const data = await response.json().catch(() => ({})) as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
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

async function getSmartAIResponseInternal(
  keys: AiKeyEntry[],
  system: string,
  user: string,
  retryCount = 0,
  scope: 'global' | 'smm' = 'global'
): Promise<string> {
  if (keys.length === 0) throw new Error("API kalitlar mavjud emas!");
  const maxRetries = Math.min(keys.length, 5);
  if (retryCount >= maxRetries) throw new Error("Barcha API kalitlar tugadi (limit yoki xato).");
  if (retryCount > 0) {
    await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** retryCount, 5000)));
  }

  const { key: currentKeyObj, idx } = await selectRotatingKey(keys, scope);

  try {
    const maxTokens = MAX_TOKENS_BY_PROVIDER[currentKeyObj.type] || CONFIG.MAX_TOKENS;
    return await requestAICompletion(currentKeyObj, system, user, maxTokens, scope === 'smm' ? 20000 : 15000);
  } catch (error) {
    const errMsg = (error as any)?.message ?? '';
    const status = (error as any)?.status ?? (error as any)?.response?.status;
    if (status === 429 || status === 401 || status === 403 || status === 503 || status === 500) {
      blockedKeys.set(currentKeyObj.key, Date.now() + 5 * 60 * 1000);
      logger.warn(`[${scope.toUpperCase()} ${currentKeyObj?.type?.toUpperCase()}] Kalit #${idx} xato berdi (${status}). Keyingisiga o'tilmoqda...`);
      return getSmartAIResponseInternal(keys, system, user, retryCount + 1, scope);
    }
    if (errMsg.includes('does not support image') || errMsg.includes('image.png')) {
      logger.warn(`[${scope.toUpperCase()}] Groq image-input error on key #${idx}. Content contains image references. Falling through.`);
      return getSmartAIResponseInternal(keys, system, user, retryCount + 1, scope);
    }
    throw error;
  }
}

/** Bazadan va ENV dan kalitlarni yuklash */
export async function refreshKeyPool() {
  await withKeyMutex(async () => {
    try {
      const dbKeys = await DBService.getValidApiKeys();
      const allKeys = buildKeyPoolFromEnv();
      for (const dbK of dbKeys) {
        if (!allKeys.find((k) => k.key === dbK.key)) {
          allKeys.push(dbK as AiKeyEntry);
        }
      }
      activeKeys = allKeys;
      globalKeyIndex = 0;
      embeddingKeyIndex = 0;
      for (const key of groqClients.keys()) {
        if (!allKeys.find(k => k.key === key)) groqClients.delete(key);
      }
      for (const key of openaiClients.keys()) {
        const realKey = key.includes(':') ? key.split(':')[1] : key;
        if (!allKeys.find(k => k.key === realKey)) openaiClients.delete(key);
      }

      const byProvider = countKeysByProvider(activeKeys);
      logger.info(`🔄 AI Key Pool yangilandi. Jami: ${activeKeys.length} ta kalit.`, byProvider);
    } catch (e: any) {
      logger.error(`Key pool refresh failed: ${e.message}`);
    }
  });
}
export async function getSmartAIResponse(system: string, user: string, retryCount = 0): Promise<string> {
  return getSmartAIResponseInternal(activeKeys, system, user, retryCount, 'global');
}
export async function validateKey(type: "groq" | "cerebras" | "openrouter" | "gemini" | "openai" | "google", key: string): Promise<boolean> {
  try {
    if (type === "openrouter") {
      const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { "Authorization": `Bearer ${key}` }
      });
      return response.ok;
    }

    if (type === "groq") {
      const response = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { "Authorization": `Bearer ${key}` }
      });
      return response.ok;
    } else if (type === "gemini" || type === "google") {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${key}`);
      if (!response.ok) return false;
      const data = await response.json() as any;
      return Array.isArray(data.models) && data.models.length > 0;
    } else if (type === "openai") {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { "Authorization": `Bearer ${key}` }
      });
      return response.ok;
    } else {
      let baseURL: string;
      if (type === "cerebras") {
        baseURL = "https://api.cerebras.ai/v1";
      } else {
        throw new Error(`Unknown API key type: ${type}`);
      }
      const response = await fetch(`${baseURL}/models`, {
        headers: { "Authorization": `Bearer ${key}` }
      });
      return response.ok;
    }
    } catch (e: any) {
    logger.error(`API Key validation failed (${type}): ${e.message}`);
    return false;
  }
}
export async function isDuplicateAI(userId: number, title: string, content: string): Promise<boolean> {
  const lastTitles = await DBService.getLastTitles(userId, 20);
  if (lastTitles.length === 0) return false;

  try {
    const res = await getSmartAIResponse(
      CONFIG.DEDUPLICATION_PROMPT,
      `POSTED TITLES:\n${lastTitles.join("\n")}\n\nNEW ITEM:\nTitle: ${title}\nContent: ${content.slice(0, 1000)}`
    );
    
    const isDup = res.toUpperCase().includes("DUPLICATE");
    if (isDup) logger.info(`🚫 AI Dublikat aniqlandi (User: ${userId}): ${title.slice(0, 40)}...`);
    return isDup;
  } catch (err: any) {
    logger.error(`Dublikat tekshirishda AI xatosi: ${err.message}`);
    return true;
  }
}
export async function checkSemanticDuplicate(userId: number, title: string, content: string): Promise<boolean> {
  try {
    const textToEmbed = `${title}\n${content.slice(0, 500)}`;
    const embedding = await getEmbedding(textToEmbed);
    
    if (!embedding) {
      logger.warn(`⚠️ Semantic check skipped for user ${userId}: embedding failed`);
      return false;
    }

    const similar = await DBService.findSimilarNews(userId, embedding, 0.9);
    if (similar) {
       logger.info(`🚫 Vektorli Dublikat aniqlandi (User: ${userId}, Similarity: ${Math.round(similar.similarity * 100)}%): ${title.slice(0, 40)}...`);
       return true;
    }

    const hash = crypto.createHash('md5').update(textToEmbed).digest('hex');
    await DBService.saveEmbedding(userId, hash, embedding);
    
    return false;
  } catch (e: any) {
    logger.error(`Semantic duplicate check error: ${e.message}`);
    return false;
  }
}
export async function getNiceEmoji(title: string): Promise<string> {
  try {
    const res = await getSmartAIResponse(
      "Pick one relevant emoji for this news topic. Output ONLY the emoji.",
      title
    );
    const emojis = res.match(/[\p{Emoji}\u200d]+/gu);
    const emoji = emojis ? emojis[0] : "🔹";
    return emoji || "🔹";
  } catch {
    return "🔹";
  }
}
export async function moderateContent(title: string, content: string): Promise<{status: 'SAFE'|'BLOCKED', reason?: string}> {
  const categories = [
    {label: 'Jinsiy zo\'ravonlik va Pornografiya', description: 'Sexual violence, sexual assault, harassment, or explicit adult content.'},
    {label: 'Diniy aqidaparastlik va Ekstremizm', description: 'Religious extremism, radicalization, promotion of jihad, or sectarian hate speech.'},
    {label: 'Terrorizm targ\'iboti', description: 'Promotion or glorification of terrorist acts, organizations, or illegal armed groups.'},
  ];
  
  const systemPrompt = `Siz kontent moderatori ekansiz. Berilgan yangilikni quyidagi taqiqlangan kategoriyalar bo'yicha tekshiring:
  1. ${categories[0].label}: ${categories[0].description}
  2. ${categories[1].label}: ${categories[1].description}
  3. ${categories[2].label}: ${categories[2].description}

  MUHIM: 
  - Urush, harbiy harakatlar, dron hujumlari yoki siyosiy mojarolar haqidagi ODDYIY YANGILIKLARNI BLOKLAMANG (masalan: "Dron uchirildi", "Hujum oqibatida halok bo'ldi"). Bu xabar berish hisoblanadi.
  - FAQAT yuqoridagi taqiqlangan g'oyalarni TARG'IB qiladigan yoki o'ta qabih (jinsiy/ekstremistik) mazmundagi xabarlarni BLOKLANG.
  
  Javobingiz FAQAT bir qatordan iborat bo'lsin: "SAFE" yoki "BLOCKED: <Kategoriya nomi>".`;
  
  try {
    const safeContent = (content || '').slice(0, 1500);
    const response = await getSmartAIResponse(systemPrompt, `Sarlavha: ${title}\n\nMatn: ${safeContent}`);
    const trimmed = response.trim();
    if (trimmed.toUpperCase().startsWith('SAFE')) {
      return {status: 'SAFE'};
    }
    const match = trimmed.match(/BLOCKED[:\s]+(.+)/i);
    if (match) {
      return {status: 'BLOCKED', reason: match[1].trim()};
    }
    return {status: 'SAFE'};
  } catch (e:any) {
    logger.error(`Content moderation error: ${e.message}`);
    return {status: 'BLOCKED', reason: 'Moderation service unavailable'};
  }
}
export async function translateToUzbek(title: string, content: string) {
  const prompt = `Translate this news to Uzbek. Keep it professional. Output JSON: {"title": "...", "content": "..."}`;
  try {
    // Limit content to prevent token overflow
    const safeContent = content.slice(0, 2000);
    const res = await getSmartAIResponse(prompt, `Title: ${title}\nContent: ${safeContent}`);
    const jsonMatch = res.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.title || !parsed.content) {
        return { title: title || 'Untitled', content: content || '' };
      }
      return parsed;
    }
    throw new Error("No JSON found in response");
  } catch (err: any) {
    logger.warn(`⚠️ AI tarjima muvaffaqiyatsiz, original matn ishlatiladi: ${err.message}`);
    return { title: title || 'Untitled', content: content || '' };
  }
}

/** Gemini orqali matnli embedding (vektor) olish */
export async function getEmbedding(text: string, retryCount = 0): Promise<number[] | null> {
  if (retryCount > 5) return null;
  let keyObj: any;
  await withKeyMutex(async () => {
    if (activeKeys.length === 0) return;
    const geminiKeys = activeKeys.filter(k => k.type === 'gemini' || k.type === 'google');
    if (geminiKeys.length === 0) return;
    const safeIndex = embeddingKeyIndex % geminiKeys.length;
    keyObj = geminiKeys[safeIndex];
    embeddingKeyIndex = (embeddingKeyIndex + 1) % geminiKeys.length;
  });

  if (!keyObj) return null;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${keyObj.key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] }
      })
    });

    if (!response.ok) {
       if (response.status === 429) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return getEmbedding(text, retryCount + 1);
       }
       return null;
    }

    const data = await response.json() as any;
    return data.embedding?.values ?? null;
  } catch (e: any) {
    logger.error(`Embedding error: ${e.message}`);
    return null;
  }
}
export async function categorizeNews(title: string, content: string): Promise<string> {
  try {
    const res = await getSmartAIResponse(
      `Yangilikni FAQAT bitta kategoriya bilan belginla. Kategoriyalar: Sport, Siyosat, Iqtisodiyot, Texnologiya, Jamiyat, Madaniyat, Sogliq, Talim, Hodisalar, Boshqa. FAQAT kategoriya nomini yoz, hech narsa qo'shma.`,
      `${title}\n${content.slice(0, 300)}`
    );
    const validCategories = ['Sport', 'Siyosat', 'Iqtisodiyot', 'Texnologiya', 'Jamiyat', 'Madaniyat', 'Sogliq', 'Talim', 'Hodisalar', 'Boshqa'];
    const normalizedRes = res.replace(/[''ʻʼ`]/g, '');
    const found = validCategories.find(c => normalizedRes.includes(c));
    return found || 'Boshqa';
  } catch {
    return 'general';
  }
}
export async function categorizeAndAnalyze(title: string, content: string): Promise<{category: string, sentiment: string}> {
  try {
    const validCategories = ['Sport', 'Siyosat', 'Iqtisodiyot', 'Texnologiya', 'Jamiyat', 'Madaniyat', 'Sogliq', 'Talim', 'Hodisalar', 'Boshqa'];
    const res = await getSmartAIResponse(
      `Analyze this news and provide:
1. Category (one of: ${validCategories.join(', ')})
2. Sentiment (positive/negative/neutral)

Output JSON format: {"category": "...", "sentiment": "..."}`,
      `Title: ${title}\nContent: ${content.slice(0, 500)}`
    );
    const jsonMatch = res.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const normalizedCategory = parsed.category?.replace(/[''ʻʼ`]/g, '') || '';
      const category = validCategories.find(c => normalizedCategory.includes(c)) || 'Boshqa';
      const sentiment = ['positive', 'negative', 'neutral'].includes(parsed.sentiment?.toLowerCase()) ? parsed.sentiment.toLowerCase() : 'neutral';
      return { category, sentiment };
    }
    return { category: 'Boshqa', sentiment: 'neutral' };
  } catch {
    return { category: 'Boshqa', sentiment: 'neutral' };
  }
}

export async function analyzeSentiment(title: string): Promise<'positive' | 'negative' | 'neutral'> {
  try {
    const res = await getSmartAIResponse(
      `Bu yangilik sarlavhasining kayfiyatini aniqla. FAQAT bitta so'z yoz: "positive", "negative", yoki "neutral".`,
      title
    );
    const r = res.toLowerCase().trim();
    if (r.includes('positive')) return 'positive';
    if (r.includes('negative')) return 'negative';
    return 'neutral';
  } catch {
    return 'neutral';
  }
}
export async function selectTopNews(titles: {title: string, url: string}[]): Promise<{title: string, url: string}[]> {
  if (titles.length <= 5) return titles;
  try {
    const list = titles.map((t, i) => `[${i}] ${t.title}`).join('\n');
    const res = await getSmartAIResponse(
      `Quyidagi yangiliklar ro'yxatidan eng muhim va qiziqarli 5 tasini tanla. FAQAT JSON formatida javob ber: [0, 2, 5, 8, 12] kabi indekslar.`,
      list
    );
    const match = res.match(/\[[\d,\s]+\]/);
    if (match) {
      try {
        const indices: number[] = JSON.parse(match[0]);
        const selected = indices
          .filter(i => typeof i === 'number' && i >= 0 && i < titles.length)
          .slice(0, 5)
          .map(i => titles[i])
          .filter(Boolean);
        if (selected.length > 0) return selected;
      } catch {
        // If JSON parsing fails, fall through to default
      }
    }
    return titles.slice(0, 5);
  } catch {
    return titles.slice(0, 5);
  }
}

function getKeysSortedForSmm(): AiKeyEntry[] {
  const preferred: AiKeyEntry['type'][] = ['gemini', 'google', 'openrouter', 'groq', 'cerebras', 'openai'];
  return [...activeKeys].sort(
    (a, b) => preferred.indexOf(a.type) - preferred.indexOf(b.type)
  );
}

async function getSmartAIResponseWithKeys(
  keys: AiKeyEntry[],
  system: string,
  user: string,
  retryCount = 0
): Promise<string> {
  return getSmartAIResponseInternal(keys, system, user, retryCount, 'smm');
}

export function getActiveKeyStats() {
  return {
    total: activeKeys.length,
    byProvider: countKeysByProvider(activeKeys),
  };
}

export async function generateSmmPost(topic: string, lang: string = "uz"): Promise<string> {
  if (activeKeys.length === 0) {
    await refreshKeyPool();
  }
  if (activeKeys.length === 0) {
    throw new Error(
      "AI kalitlari topilmadi. Render .env da GROQ_KEYS yoki GEMINI_KEYS (vergul yoki yangi qator bilan) tekshiring."
    );
  }

  const cleanTopic = topic.trim();
  const languagePromptMap: Record<string, string> = {
    uz: "FAQAT o'zbek tilida yozing.",
    ru: "Пишите только на русском языке.",
    en: "Write only in English.",
    tr: "Yalnızca Türkçe yazın.",
    de: "Schreiben Sie nur auf Deutsch.",
    fr: "Écrivez uniquement en français.",
    es: "Escriba solo en español.",
    it: "Scrivi solo in italiano.",
    pt: "Escreva apenas em português.",
    ar: "اكتب بالعربية فقط.",
    hi: "केवल हिन्दी में लिखें।",
    zh: "仅使用中文写作。",
    ja: "日本語のみで書いてください。",
    ko: "한국어로만 작성하세요.",
    fa: "فقط به فارسی بنویسید.",
  };
  const systemPrompt =
    "Siz mashhur Telegram kanallari uchun SMM post yozuvchisisiz.\n" +
    `${languagePromptMap[lang] || languagePromptMap.uz}\n` +
    "Foydalanuvchi bergan MAVZU — postning yagona mavzusi; boshqa mavzuga o'tmang.\n" +
    "Format: qiziqarli sarlavha (1 qator), keyin 3-4 qisqa paragraph, oxirida CTA.\n" +
    "80-140 so'z, tegishli emojilar (4-8 ta).\n" +
    "Taqiqlangan: umumiy salomlashish, 'bugun sizga', mavzudan uzoq matn, inglizcha so'zlar.\n" +
    "Faqat tayyor post matnini qaytaring.";

  const userPrompt =
    `MAVZU: «${cleanTopic}»\n\n` +
    `Yuqoridagi mavzu bo'yicha Telegram kanalga joylash uchun viral post yozing. ` +
    `Post mazmuni aynan shu mavzuga tegishli bo'lsin.`;

  const smmKeys = getKeysSortedForSmm();
  let text = (await getSmartAIResponseWithKeys(smmKeys, systemPrompt, userPrompt)).trim();
  text = text.replace(/^```(?:markdown|text)?\s*/i, '').replace(/```\s*$/i, '').trim();

  if (!text || text.length < 25) {
    throw new Error('AI mavzuga mos post yaratmadi. API kalitlarini tekshiring.');
  }

  return text;
}

export type SmmImageResult = { imageUrl: string; imageBase64: string | null };

function extractJsonBlock(text: string): Record<string, any> | null {
  const cleaned = String(text || '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function generateSmmImage(topic: string): Promise<SmmImageResult> {
  const cleanTopic = topic.trim().slice(0, 200);
  let visualSpec = {
    subject: cleanTopic,
    setting: 'clean editorial social media scene',
    action: 'main subject presented clearly',
    style: 'realistic, high-contrast, premium',
    mustInclude: cleanTopic,
    mustAvoid: 'text, watermark, unrelated objects, generic stock visuals',
  };
  try {
    const brief = await getSmartAIResponse(
      "You are a visual director for social media. Return STRICT JSON only with keys: subject, setting, action, style, mustInclude, mustAvoid. Make the subject match the user topic exactly and keep the scene concrete, specific, and visually unambiguous. No markdown, no bullets, no extra text.",
      cleanTopic
    );
    const parsed = extractJsonBlock(brief || '');
    if (parsed) {
      visualSpec = {
        subject: String(parsed.subject || visualSpec.subject).trim().slice(0, 120),
        setting: String(parsed.setting || visualSpec.setting).trim().slice(0, 140),
        action: String(parsed.action || visualSpec.action).trim().slice(0, 140),
        style: String(parsed.style || visualSpec.style).trim().slice(0, 140),
        mustInclude: String(parsed.mustInclude || visualSpec.mustInclude).trim().slice(0, 160),
        mustAvoid: String(parsed.mustAvoid || visualSpec.mustAvoid).trim().slice(0, 160),
      };
    }
  } catch (e: any) {
    logger.warn(`SMM visual brief fallback used: ${e.message}`);
  }

  const promptVariants = [
    `Editorial social media image where the subject is exactly "${visualSpec.subject}". Scene: ${visualSpec.setting}. Action: ${visualSpec.action}. Style: ${visualSpec.style}. Must include: ${visualSpec.mustInclude}. Must avoid: ${visualSpec.mustAvoid}. Realistic, 16:9 composition, strong focal subject, no text, no watermark, no unrelated objects.`,
    `Create a news-style visual strictly about "${visualSpec.subject}". Background: ${visualSpec.setting}. Main action: ${visualSpec.action}. Visual style: ${visualSpec.style}. The image must instantly communicate the exact topic and nothing else. No text, no logos, no watermark, no generic stock scene.`,
    `High-quality Telegram post illustration for "${visualSpec.subject}". Use this exact topic as the central subject: ${visualSpec.mustInclude}. Scene details: ${visualSpec.setting}. Composition: ${visualSpec.action}. Style: ${visualSpec.style}. No text, no extra subjects, no unrelated props, no watermark.`
  ];

  const seed = Date.now() % 1_000_000;
  const tryFetchImage = async (imagePrompt: string, variantIndex: number): Promise<SmmImageResult | null> => {
    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=1280&height=720&nologo=true&seed=${seed + variantIndex}&model=flux`;
    try {
      const res = await fetch(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 mateAssistentBot/1.0' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return null;
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.startsWith('image/')) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 8 * 1024) return null;
      return { imageUrl, imageBase64: `data:image/jpeg;base64,${buf.toString('base64')}` };
    } catch (e: any) {
      logger.warn(`SMM image fetch failed: ${e.message}`);
      return null;
    }
  };

  const settled = await Promise.all(promptVariants.map((variant, index) => tryFetchImage(variant, index)));
  const firstOk = settled.find(Boolean);
  if (firstOk) return firstOk;

  const fallbackPrompt = promptVariants[0];
  return {
    imageUrl: `https://image.pollinations.ai/prompt/${encodeURIComponent(fallbackPrompt)}?width=1280&height=720&nologo=true&seed=${seed}&model=flux`,
    imageBase64: null
  };
}

export async function generateAudioSummary(title: string, content: string, lang: string = 'uz'): Promise<string> {
  const languagePromptMap: Record<string, string> = {
    uz: "Faqat o'zbek tilida, ravon va eshittirish uslubida yozing.",
    ru: "Пишите только на русском языке, естественно и как для аудио-новости.",
    en: "Write only in English in a natural spoken-news style.",
  };
  const summary = await getSmartAIResponse(
    `Bu yangilikni 3-4 jumlada qisqacha xulosa qil. Podcast uchun tabiiy, quloqqa yoqimli tilda yoz. ${languagePromptMap[lang] || languagePromptMap.uz}`,
    `${title}\n${content.slice(0, 1400)}`
  );
  return summary;
}

export async function generateSummary(title: string, content: string): Promise<string> {
  try {
    const summary = await getSmartAIResponse(
      `Siz professional jurnalistsiz. Berilgan yangilikning eng asosiy mazmunini bitta qisqa abzatsda (1-2 gapda) tushunarli qilib yozib bering. Hech qanday kirish so'zlarisiz (masalan: "Xulosa shuki") to'g'ridan to'g'ri faktni yozing. O'zbek tilida.`,
      `${title}\n${content.slice(0, 800)}`
    );
    return summary.trim();
  } catch {
    return "";
  }
}
function normalizeTextForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`#>\[\]()]/g, ' ')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function generateTTS(text: string, lang: string = 'uz'): Promise<Buffer | null> {
  try {
    const safeText = normalizeTextForSpeech(text).slice(0, 800).trim();
    if (!safeText) return null;

    // Strategy 1: Google Translate TTS via direct HTTP request
    try {
      const ttsLangs: Record<string, string> = { uz: 'uz', ru: 'ru', en: 'en' };
      const ttsLang = ttsLangs[lang] || 'uz';
      const chunks = splitText(safeText, 180);
      const audioBuffers: Buffer[] = [];

      for (const chunk of chunks) {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${ttsLang}&client=tw-ob`;
        const res = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://translate.google.com',
          },
        });
        const buf = Buffer.from(res.data);
        if (buf.length > 200) audioBuffers.push(buf);
      }

      if (audioBuffers.length > 0) {
        logger.info(`TTS: Google generated ${audioBuffers.length} chunks, ${audioBuffers.reduce((s, b) => s + b.length, 0)} bytes`);
        return Buffer.concat(audioBuffers);
      }
    } catch (googleErr: any) {
      logger.warn(`Google TTS failed: ${googleErr.message}`);
    }

    // Strategy 2: Edge TTS as fallback
    try {
      const tts = new EdgeTTS();
      const voiceMap: Record<string, string[]> = {
        uz: ['uz-UZ-SardorNeural', 'uz-UZ-MadinaNeural'],
        ru: ['ru-RU-SvetlanaNeural', 'ru-RU-DmitryNeural'],
        en: ['en-US-AvaNeural', 'en-US-AndrewNeural'],
      };
      const voices = voiceMap[lang] || voiceMap.uz;
      for (const voice of voices) {
        try {
          await tts.synthesize(safeText, voice, {
            outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
          });
          const buf = tts.toBuffer();
          if (buf && buf.length > 200) {
            logger.info(`TTS: Edge generated ${buf.length} bytes (voice: ${voice})`);
            return buf;
          }
        } catch (voiceErr: any) {
          logger.warn(`TTS voice ${voice} failed: ${voiceErr.message}`);
        }
      }
    } catch (edgeErr: any) {
      logger.error(`Edge TTS failed: ${edgeErr.message}`);
    }

    return null;
  } catch (e: any) {
    logger.error(`TTS Error: ${e.message}`);
    return null;
  }
}

function splitText(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > maxLen && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}
