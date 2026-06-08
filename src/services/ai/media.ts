import { EdgeTTS } from "@andresaya/edge-tts";
import axios from 'axios';
import { logger } from "../../utils/logger";
import { getSmartAIResponse, getSmartAIResponseWithKeys } from "./core";
import { getKeysSortedForSmm, activeKeys, refreshKeyPool } from "./key-pool";

export async function generateSmmPost(topic: string, lang: string = "uz", size: 'short' | 'medium' | 'long' = 'medium'): Promise<string> {
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
  const sizeGuides: Record<typeof size, string> = {
    short: "45-70 so'z, 1 qisqa paragraph va 1 CTA.",
    medium: "80-140 so'z, 2-3 qisqa paragraph va 1 CTA.",
    long: "150-220 so'z, 3-4 paragraph va aniq CTA.",
  };
  const systemPrompt =
    "Siz mashhur Telegram kanallari uchun SMM post yozuvchisisiz.\n" +
    `${languagePromptMap[lang] || languagePromptMap.uz}\n` +
    "Foydalanuvchi bergan MAVZU — postning yagona mavzusi; boshqa mavzuga o'tmang.\n" +
    `Post hajmi: ${sizeGuides[size]}\n` +
    "Format: qiziqarli sarlavha (1 qator), keyin qisqa, ixcham matn va oxirida CTA.\n" +
    "Tegishli emojilar ishlating, lekin ortiqcha bezatmang.\n" +
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

function extractJsonBlock(text: string): Record<string, unknown> | null {
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
  } catch (e: unknown) {
    logger.warn(`SMM visual brief fallback used: ${e instanceof Error ? e.message : String(e)}`);
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
    } catch (e: unknown) {
      logger.warn(`SMM image fetch failed: ${e instanceof Error ? e.message : String(e)}`);
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
    } catch (googleErr: unknown) {
      logger.warn(`Google TTS failed: ${googleErr instanceof Error ? googleErr.message : String(googleErr)}`);
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
        } catch (voiceErr: unknown) {
          logger.warn(`TTS voice ${voice} failed: ${voiceErr instanceof Error ? voiceErr.message : String(voiceErr)}`);
        }
      }
    } catch (edgeErr: unknown) {
      logger.error(`Edge TTS failed: ${edgeErr instanceof Error ? edgeErr.message : String(edgeErr)}`);
    }

    return null;
  } catch (e: unknown) {
    logger.error(`TTS Error: ${e instanceof Error ? e.message : String(e)}`);
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
