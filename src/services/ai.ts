import { OpenAI } from "openai";
import Groq from "groq-sdk";
import { EdgeTTS } from "@andresaya/edge-tts";
import crypto from 'crypto';
import axios from 'axios';
import { buildKeyPoolFromEnv, countKeysByProvider, CONFIG, MAX_TOKENS_BY_PROVIDER } from "../config/config";
import type { AiKeyEntry } from "../config/config";
import { logger } from "../utils/logger";
import { DBService } from "./database";

// BUG-031 Fix: Use mutex to prevent race conditions on globalKeyIndex
let globalKeyIndex = 0;
let embeddingKeyIndex = 0;
let activeKeys: AiKeyEntry[] = buildKeyPoolFromEnv();
const keyMutex = { locked: false, queue: [] as (() => void)[] };

async function withKeyMutex<T>(fn: () => Promise<T>): Promise<T> {
  while (keyMutex.locked) {
    await new Promise<void>(resolve => keyMutex.queue.push(resolve));
  }
  keyMutex.locked = true;
  try {
    return await fn();
  } finally {
    keyMutex.locked = false;
    keyMutex.queue.shift()?.();
  }
}

// Client caching to save resources
const groqClients = new Map<string, Groq>();
const openaiClients = new Map<string, OpenAI>();

// Circuit Breaker for temporarily failed or rate-limited API keys
const blockedKeys = new Map<string, number>();

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
      // BUG-004 Fix: Reset globalKeyIndex
      globalKeyIndex = 0;
      // BUG-036 Fix: Reset embedding index to prevent out-of-range
      embeddingKeyIndex = 0;
      
      // BUG-131 Fix: Clean up old clients from Maps to prevent memory leak
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

// BUG-032 Fix: Limit retries to Math.min(activeKeys.length, 10) and prevent infinite loop with 1 key
export async function getSmartAIResponse(system: string, user: string, retryCount = 0): Promise<string> {
  if (activeKeys.length === 0) throw new Error("API kalitlar mavjud emas!");
  const maxRetries = Math.min(activeKeys.length, 5);
  if (retryCount >= maxRetries) throw new Error("Barcha API kalitlar tugadi (limit yoki xato).");
  
  // BUG-003 Fix: Max delay 5 seconds to avoid Webhook timeout
  if (retryCount > 0) {
    await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** retryCount, 5000)));
  }
  
  // BUG-001 & BUG-002 Fix: Extract key selection to happen inside mutex, but execution and retry outside
  let currentKeyObj: any;
  let idx = 0;
  
  await withKeyMutex(async () => {
    const now = Date.now();
    const availableKeys = activeKeys.filter(k => {
      const blockedUntil = blockedKeys.get(k.key);
      return !blockedUntil || blockedUntil < now;
    });
    const poolToUse = availableKeys.length > 0 ? availableKeys : activeKeys;

    idx = globalKeyIndex % poolToUse.length;
    currentKeyObj = poolToUse[idx];
    globalKeyIndex = (globalKeyIndex + 1) % poolToUse.length;
  });

  try {
    // BUG-001 Fix: Use provider-specific max tokens
    const maxTokens = MAX_TOKENS_BY_PROVIDER[currentKeyObj.type] || CONFIG.MAX_TOKENS;

    if (currentKeyObj.type === "groq") {
      let groq = groqClients.get(currentKeyObj.key);
      if (!groq) {
        groq = new Groq({ apiKey: currentKeyObj.key, timeout: 15000 });
        groqClients.set(currentKeyObj.key, groq);
      }
      // BUG-033 Fix: Added max_tokens for Groq
      const res = await groq.chat.completions.create({
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        model: "llama-3.3-70b-versatile",
        max_tokens: maxTokens,
      });
      return res.choices[0]?.message?.content ?? "";
    } else if (currentKeyObj.type === "gemini" || currentKeyObj.type === "google") {
      // BUG-034 Fix: Use gemini-2.0-flash (widely supported)
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${currentKeyObj.key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ parts: [{ text: user }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: CONFIG.TEMPERATURE }
        })
      });
      
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw Object.assign(new Error(`Gemini API error: ${response.statusText} ${errorBody}`), { status: response.status });
      }
      
      const data = await response.json().catch(() => ({})) as any;
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    } else if (currentKeyObj.type === "openai") {
      let client = openaiClients.get(currentKeyObj.key);
      if (!client) {
        client = new OpenAI({ apiKey: currentKeyObj.key, timeout: 15000 });
        openaiClients.set(currentKeyObj.key, client);
      }
      const res = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens,
      });
      return res.choices[0]?.message?.content ?? "";
    } else {
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
      
      let client = openaiClients.get(`${baseURL}:${currentKeyObj.key}`);
      if (!client) {
        client = new OpenAI({
          apiKey: currentKeyObj.key,
          baseURL,
          timeout: 15000
        });
        openaiClients.set(`${baseURL}:${currentKeyObj.key}`, client);
      }
      
      const res = await client.chat.completions.create({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: maxTokens,
      });
      return res.choices[0]?.message?.content ?? "";
    }
  } catch (error) {
    const status = (error as any)?.status ?? (error as any)?.response?.status;
    if (status === 429 || status === 401 || status === 403 || status === 503 || status === 500) {
      if (currentKeyObj?.key) {
        blockedKeys.set(currentKeyObj.key, Date.now() + 5 * 60 * 1000); // Block key for 5 minutes
      }
      logger.warn(`[${currentKeyObj?.type?.toUpperCase()}] Kalit #${idx} xato berdi (${status}). Keyingisiga o'tilmoqda...`);
      return getSmartAIResponse(system, user, retryCount + 1);
    }
    throw error;
  }
}

// BUG-035 Fix: Use same model for validation as main usage
export async function validateKey(type: "groq" | "cerebras" | "openrouter" | "gemini" | "openai" | "google", key: string): Promise<boolean> {
  try {
    if (type === "openrouter") {
      const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { "Authorization": `Bearer ${key}` }
      });
      return response.ok;
    }

    if (type === "groq") {
      // B-24 Fix: Use GET /models endpoint instead of making API call that costs tokens
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
      // B-24 Fix: Use GET /models endpoint instead of making API call that costs tokens
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
      // B-24 Fix: Use GET /models endpoint instead of making API call that costs tokens
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


// B-57 Fix: Reduce lastTitles count to prevent token overflow
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
    return true; // BUG-007 Fix: Fail-safe to avoid spamming if AI fails
  }
}

// BUG-043 Fix: Log warning when embedding returns null
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


// B-33 Fix: Add fallback for empty AI responses
export async function getNiceEmoji(title: string): Promise<string> {
  try {
    const res = await getSmartAIResponse(
      "Pick one relevant emoji for this news topic. Output ONLY the emoji.",
      title
    );
    // BUG-009 Fix: Safely extract first emoji to support multi-byte Unicode
    const emojis = res.match(/[\p{Emoji}\u200d]+/gu);
    const emoji = emojis ? emojis[0] : "🔹";
    // B-33 Fix: Return fallback if empty
    return emoji || "🔹";
  } catch {
    return "🔹";
  }
}

// BUG-041 Fix: Removed redundant toUpperCase before regex with /i flag
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

// BUG-038 Fix: Log warning when translation fails
// B-17 Fix: Add content length limit to prevent token overflow
// B-33 Fix: Add fallback for empty AI responses
export async function translateToUzbek(title: string, content: string) {
  const prompt = `Translate this news to Uzbek. Keep it professional. Output JSON: {"title": "...", "content": "..."}`;
  try {
    // Limit content to prevent token overflow
    const safeContent = content.slice(0, 2000);
    const res = await getSmartAIResponse(prompt, `Title: ${title}\nContent: ${safeContent}`);
    const jsonMatch = res.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // B-33 Fix: Add fallback for empty responses
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
// BUG-036 Fix: Safe embedding key index management with proper retry
export async function getEmbedding(text: string, retryCount = 0): Promise<number[] | null> {
  if (retryCount > 5) return null;
  if (activeKeys.length === 0) return null;

  const geminiKeys = activeKeys.filter(k => k.type === 'gemini' || k.type === 'google');
  if (geminiKeys.length === 0) {
    return null;
  }

  let keyObj: any;
  await withKeyMutex(async () => {
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
          // BUG-009 Fix: Increment retry count to prevent infinite loop
          return new Promise((resolve) => {
            setTimeout(() => resolve(getEmbedding(text, retryCount + 1)), 1000);
          });
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

// BUG-042 Fix: Normalize category comparison
export async function categorizeNews(title: string, content: string): Promise<string> {
  try {
    const res = await getSmartAIResponse(
      `Yangilikni FAQAT bitta kategoriya bilan belginla. Kategoriyalar: Sport, Siyosat, Iqtisodiyot, Texnologiya, Jamiyat, Madaniyat, Sogliq, Talim, Hodisalar, Boshqa. FAQAT kategoriya nomini yoz, hech narsa qo'shma.`,
      `${title}\n${content.slice(0, 300)}`
    );
    const validCategories = ['Sport', 'Siyosat', 'Iqtisodiyot', 'Texnologiya', 'Jamiyat', 'Madaniyat', 'Sogliq', 'Talim', 'Hodisalar', 'Boshqa'];
    // BUG-042 Fix: Normalize by removing apostrophes and comparing
    const normalizedRes = res.replace(/[''ʻʼ`]/g, '');
    const found = validCategories.find(c => normalizedRes.includes(c));
    return found || 'Boshqa';
  } catch {
    return 'general';
  }
}

// B-37 Fix: Combined function to get both category and sentiment in one API call
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

// BUG-040 Fix: Validate AI-returned indices against array bounds
// B-43 Fix: Improve selectTopNews JSON parsing with better error handling
export async function selectTopNews(titles: {title: string, url: string}[]): Promise<{title: string, url: string}[]> {
  if (titles.length <= 5) return titles;
  try {
    const list = titles.map((t, i) => `[${i}] ${t.title}`).join('\n');
    const res = await getSmartAIResponse(
      `Quyidagi yangiliklar ro'yxatidan eng muhim va qiziqarli 5 tasini tanla. FAQAT JSON formatida javob ber: [0, 2, 5, 8, 12] kabi indekslar.`,
      list
    );
    // B-43 Fix: More flexible JSON parsing to handle various AI response formats
    const match = res.match(/\[[\d,\s]+\]/);
    if (match) {
      try {
        const indices: number[] = JSON.parse(match[0]);
        // BUG-040 Fix: Validate indices are in range
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
  if (keys.length === 0) throw new Error('API kalitlar mavjud emas!');
  const maxRetries = Math.min(keys.length, 5);
  if (retryCount >= maxRetries) throw new Error('Barcha API kalitlar tugadi (limit yoki xato).');

  if (retryCount > 0) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** retryCount, 5000)));
  }

  const now = Date.now();
  const availableKeys = keys.filter(k => {
    const blockedUntil = blockedKeys.get(k.key);
    return !blockedUntil || blockedUntil < now;
  });
  const poolToUse = availableKeys.length > 0 ? availableKeys : keys;

  const idx = retryCount % poolToUse.length;
  const currentKeyObj = poolToUse[idx];

  try {
    const maxTokens = MAX_TOKENS_BY_PROVIDER[currentKeyObj.type] || CONFIG.MAX_TOKENS;

    if (currentKeyObj.type === 'groq') {
      let groq = groqClients.get(currentKeyObj.key);
      if (!groq) {
        groq = new Groq({ apiKey: currentKeyObj.key, timeout: 20000 });
        groqClients.set(currentKeyObj.key, groq);
      }
      const res = await groq.chat.completions.create({
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        model: 'llama-3.3-70b-versatile',
        max_tokens: maxTokens,
      });
      return res.choices[0]?.message?.content ?? '';
    }

    if (currentKeyObj.type === 'gemini' || currentKeyObj.type === 'google') {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${currentKeyObj.key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ parts: [{ text: user }] }],
            generationConfig: { maxOutputTokens: maxTokens, temperature: CONFIG.TEMPERATURE },
          }),
          signal: AbortSignal.timeout(25000),
        }
      );
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw Object.assign(new Error(`Gemini API error: ${response.statusText} ${errorBody}`), {
          status: response.status,
        });
      }
      const data = (await response.json().catch(() => ({}))) as any;
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    }

    if (currentKeyObj.type === 'openai') {
      let client = openaiClients.get(currentKeyObj.key);
      if (!client) {
        client = new OpenAI({ apiKey: currentKeyObj.key, timeout: 20000 });
        openaiClients.set(currentKeyObj.key, client);
      }
      const res = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        max_tokens: maxTokens,
      });
      return res.choices[0]?.message?.content ?? '';
    }

    let baseURL: string;
    let model: string;
    switch (currentKeyObj.type) {
      case 'cerebras':
        baseURL = 'https://api.cerebras.ai/v1';
        model = 'llama-3.1-70b';
        break;
      case 'openrouter':
        baseURL = 'https://openrouter.ai/api/v1';
        model = 'google/gemini-2.0-flash-001';
        break;
      default:
        throw new Error(`Unsupported AI provider type: ${currentKeyObj.type}`);
    }

    let client = openaiClients.get(`${baseURL}:${currentKeyObj.key}`);
    if (!client) {
      client = new OpenAI({ apiKey: currentKeyObj.key, baseURL, timeout: 20000 });
      openaiClients.set(`${baseURL}:${currentKeyObj.key}`, client);
    }
    const res = await client.chat.completions.create({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message?.content ?? '';
  } catch (error) {
    const status = (error as any)?.status ?? (error as any)?.response?.status;
    if (status === 429 || status === 401 || status === 403 || status === 503 || status === 500) {
      if (currentKeyObj?.key) {
        blockedKeys.set(currentKeyObj.key, Date.now() + 5 * 60 * 1000); // Block key for 5 minutes
      }
      logger.warn(`[SMM ${currentKeyObj?.type?.toUpperCase()}] Kalit #${idx} xato (${status}), keyingisi...`);
      return getSmartAIResponseWithKeys(keys, system, user, retryCount + 1);
    }
    throw error;
  }
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

export async function generateSmmImage(topic: string): Promise<SmmImageResult> {
  const cleanTopic = topic.trim().slice(0, 200);
  const imagePrompt =
    `Editorial social media image strictly about: ${cleanTopic}. ` +
    `Main subject must clearly match this topic: ${cleanTopic}. ` +
    'Single coherent scene, realistic or premium illustrative style, strong focal subject, 16:9 composition, high detail, no text, no letters, no watermark, no unrelated objects, avoid generic stock scenes.';

  const seed = Date.now() % 1_000_000;
  const urls = [
    `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=1280&height=720&nologo=true&seed=${seed}&model=flux`,
    `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=1024&height=576&nologo=true&seed=${seed + 1}`,
  ];

  const tryFetchImage = async (imageUrl: string): Promise<SmmImageResult | null> => {
    try {
      const res = await fetch(imageUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 mateAssistentBot/1.0' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return null;
      const contentType = (res.headers.get('content-type') || '').toLowerCase();
      if (!contentType.startsWith('image/')) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 2000) return null;
      return { imageUrl, imageBase64: `data:image/jpeg;base64,${buf.toString('base64')}` };
    } catch (e: any) {
      logger.warn(`SMM image fetch failed: ${e.message}`);
      return null;
    }
  };

  const settled = await Promise.all(urls.map((imageUrl) => tryFetchImage(imageUrl)));
  const firstOk = settled.find(Boolean);
  if (firstOk) return firstOk;

  return { imageUrl: urls[0], imageBase64: null };
}

export async function generateAudioSummary(title: string, content: string): Promise<string> {
  const summary = await getSmartAIResponse(
    `Bu yangilikni 3-4 jumlada qisqacha xulosa qil. Podcast uchun tabiiy, quloqqa yoqimli tilda yoz. O'zbek tilida.`,
    `${title}\n${content.slice(0, 1000)}`
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

// B-30 Fix: Increase TTS text limit to 500-800 chars for better summaries
export async function generateTTS(text: string): Promise<Buffer | null> {
  try {
    const safeText = text.slice(0, 800).trim();
    if (!safeText) return null;

    try {
      const googleTTS = await import('google-tts-api');
      if (typeof googleTTS.getAllAudioBase64 === 'function') {
        const allAudio = await googleTTS.getAllAudioBase64(safeText, {
          lang: 'uz',
          slow: false,
          host: 'https://translate.google.com',
          timeout: 15000,
        });
        const buffers = allAudio
          .map((a: any) => Buffer.from(a.base64, 'base64'))
          .filter((buf: Buffer) => buf.length > 100);
        if (buffers.length) return Buffer.concat(buffers);
      }
    } catch (googleErr: any) {
      logger.warn(`Google TTS primary failed: ${googleErr.message}`);
    }

    const tts = new EdgeTTS();
    await tts.synthesize(safeText, 'uz-UZ-MadinaNeural', {
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    });
    const buf = await tts.toBuffer();
    return buf && buf.length > 100 ? buf : null;
  } catch (e: any) {
    logger.error(`TTS Error: ${e.message}`);
    return null;
  }
}
