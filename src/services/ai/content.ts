import crypto from 'crypto';
import { CONFIG } from "../../config/config";
import type { AiKeyEntry } from "../../config/config";
import { logger } from "../../utils/logger";
import { DBService } from "../database";
import { getSmartAIResponse } from "./core";
import { activeKeys, withKeyMutex, embeddingKeyIndex } from "./key-pool";
import type { GeminiEmbeddingResponse } from "./key-pool";

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
  } catch (err: unknown) {
    logger.error(`Dublikat tekshirishda AI xatosi: ${err instanceof Error ? err.message : String(err)}`);
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
  } catch (e: unknown) {
    logger.error(`Semantic duplicate check error: ${e instanceof Error ? e.message : String(e)}`);
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
  - Urush, harbiy harakatlar, dron hujumlari yoki siyosiy mojarolar haqidagi ODDIY YANGILIKLARNI BLOKLAMANG (masalan: "Dron uchirildi", "Hujum oqibatida halok bo'ldi"). Bu xabar berish hisoblanadi.
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
  } catch (e: unknown) {
    logger.error(`Content moderation error: ${e instanceof Error ? e.message : String(e)}`);
    return {status: 'BLOCKED', reason: 'Moderation service unavailable'};
  }
}

export async function translateToUzbek(title: string, content: string) {
  const prompt = `Translate this news to Uzbek. Keep it professional. Output JSON: {"title": "...", "content": "..."}`;
  try {
    const safeContent = content.slice(0, 2000);
    const res = await getSmartAIResponse(prompt, `Title: ${title}\nContent: ${safeContent}`);
    const jsonMatch = res.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed: Record<string, unknown> = JSON.parse(jsonMatch[0]);
      if (!parsed.title || !parsed.content) {
        return { title: title || 'Untitled', content: content || '' };
      }
      return { title: String(parsed.title), content: String(parsed.content) };
    }
    throw new Error("No JSON found in response");
  } catch (err: unknown) {
    logger.warn(`⚠️ AI tarjima muvaffaqiyatsiz, original matn ishlatiladi: ${err instanceof Error ? err.message : String(err)}`);
    return { title: title || 'Untitled', content: content || '' };
  }
}

/** Gemini orqali matnli embedding (vektor) olish */
export async function getEmbedding(text: string, retryCount = 0): Promise<number[] | null> {
  if (retryCount > 5) return null;
  let keyObj: AiKeyEntry | undefined;
  await withKeyMutex(async () => {
    if (activeKeys.length === 0) return;
    const geminiKeys = activeKeys.filter(k => k.type === 'gemini' || k.type === 'google');
    if (geminiKeys.length === 0) return;
    const safeIndex = embeddingKeyIndex.value % geminiKeys.length;
    keyObj = geminiKeys[safeIndex];
    embeddingKeyIndex.value = (embeddingKeyIndex.value + 1) % geminiKeys.length;
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

    const data = await response.json().catch(() => ({})) as GeminiEmbeddingResponse;
    const embedding = data.embedding;
    return embedding?.values ?? null;
  } catch (e: unknown) {
    logger.error(`Embedding error: ${e instanceof Error ? e.message : String(e)}`);
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
      const parsed: Record<string, unknown> = JSON.parse(jsonMatch[0]);
      const normalizedCategory = String(parsed.category || '').replace(/[''ʻʼ`]/g, '');
      const category = validCategories.find(c => normalizedCategory.includes(c)) || 'Boshqa';
      const sentimentStr = String(parsed.sentiment || '').toLowerCase();
      const sentiment = ['positive', 'negative', 'neutral'].includes(sentimentStr) ? sentimentStr : 'neutral';
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
