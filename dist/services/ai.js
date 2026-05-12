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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshKeyPool = refreshKeyPool;
exports.getSmartAIResponse = getSmartAIResponse;
exports.validateKey = validateKey;
exports.isDuplicateAI = isDuplicateAI;
exports.checkSemanticDuplicate = checkSemanticDuplicate;
exports.getNiceEmoji = getNiceEmoji;
exports.moderateContent = moderateContent;
exports.translateToUzbek = translateToUzbek;
exports.getEmbedding = getEmbedding;
exports.categorizeNews = categorizeNews;
exports.analyzeSentiment = analyzeSentiment;
exports.selectTopNews = selectTopNews;
exports.generateAudioSummary = generateAudioSummary;
exports.generateSummary = generateSummary;
exports.generateTTS = generateTTS;
const openai_1 = require("openai");
const groq_sdk_1 = __importDefault(require("groq-sdk"));
const googleTTS = __importStar(require("google-tts-api"));
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config/config");
const logger_1 = require("../utils/logger");
const database_1 = require("./database");
let globalKeyIndex = 0;
let embeddingKeyIndex = 0;
let activeKeys = [...config_1.KEY_POOL];
/** Bazadan va ENV dan kalitlarni yuklash */
async function refreshKeyPool() {
    try {
        const dbKeys = await database_1.DBService.getValidApiKeys();
        // Unikal kalitlarni saqlaymiz (ENV + DB)
        const allKeys = [...config_1.KEY_POOL];
        for (const dbK of dbKeys) {
            if (!allKeys.find(k => k.key === dbK.key)) {
                allKeys.push(dbK);
            }
        }
        activeKeys = allKeys;
        logger_1.logger.info(`🔄 AI Key Pool yangilandi. Jami: ${activeKeys.length} ta kalit.`);
    }
    catch (e) {
        logger_1.logger.error(`Key pool refresh failed: ${e.message}`);
    }
}
async function getSmartAIResponse(system, user, retryCount = 0) {
    if (retryCount > 10)
        throw new Error("Barcha API kalitlar tugadi!");
    if (activeKeys.length === 0)
        throw new Error("API kalitlar mavjud emas!");
    // Add delay between retries to prevent rate limiting (only after first retry)
    if (retryCount > 0) {
        await new Promise(resolve => setTimeout(resolve, Math.min(1000 * 2 ** retryCount, 30000)));
    }
    const idx = globalKeyIndex % activeKeys.length;
    const currentKeyObj = activeKeys[idx];
    try {
        if (currentKeyObj.type === "groq") {
            const groq = new groq_sdk_1.default({ apiKey: currentKeyObj.key, timeout: 15000 });
            const res = await groq.chat.completions.create({
                messages: [{ role: "system", content: system }, { role: "user", content: user }],
                model: "llama-3.3-70b-versatile",
            });
            return res.choices[0]?.message?.content ?? "";
        }
        else if (currentKeyObj.type === "gemini") {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${currentKeyObj.key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    system_instruction: { parts: { text: system } },
                    contents: [{ parts: [{ text: user }] }]
                })
            });
            if (!response.ok) {
                throw Object.assign(new Error(`Gemini API error: ${response.statusText}`), { status: response.status });
            }
            const data = await response.json();
            return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        }
        else if (currentKeyObj.type === "openai") {
            const client = new openai_1.OpenAI({ apiKey: currentKeyObj.key, timeout: 15000 });
            const res = await client.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "system", content: system }, { role: "user", content: user }],
                max_tokens: config_1.CONFIG.MAX_TOKENS,
            });
            return res.choices[0]?.message?.content ?? "";
        }
        else {
            let baseURL;
            let model;
            switch (currentKeyObj.type) {
                case "cerebras":
                    baseURL = "https://api.cerebras.ai/v1";
                    model = "llama-3.1-70b";
                    break;
                default:
                    baseURL = "https://openrouter.ai/api/v1";
                    model = "google/gemini-2.0-flash-001";
                    break;
            }
            const client = new openai_1.OpenAI({
                apiKey: currentKeyObj.key,
                baseURL,
                timeout: 15000
            });
            const res = await client.chat.completions.create({
                model,
                messages: [{ role: "system", content: system }, { role: "user", content: user }],
                max_tokens: config_1.CONFIG.MAX_TOKENS,
            });
            return res.choices[0]?.message?.content ?? "";
        }
    }
    catch (error) {
        const status = error?.status ?? error?.response?.status;
        if (status === 429 || status === 401) {
            logger_1.logger.warn(`[${currentKeyObj.type.toUpperCase()}] Kalit #${idx} charchadi. Keyingisiga o'tilmoqda...`);
            globalKeyIndex = (globalKeyIndex + 1) % activeKeys.length;
            return getSmartAIResponse(system, user, retryCount + 1);
        }
        throw error;
    }
}
/** Yangi kalitni ishlayotganini tekshirish */
async function validateKey(type, key) {
    try {
        if (type === "openrouter") {
            const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
                headers: { "Authorization": `Bearer ${key}` }
            });
            return response.ok;
        }
        if (type === "groq") {
            const groq = new groq_sdk_1.default({ apiKey: key, timeout: 10000 });
            await groq.chat.completions.create({
                messages: [{ role: "user", content: "hi" }],
                model: "llama-3.1-8b-instant",
                max_tokens: 5
            });
        }
        else if (type === "gemini") {
            const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${key}`);
            if (!response.ok)
                return false;
            const data = await response.json();
            return Array.isArray(data.models) && data.models.length > 0;
        }
        else if (type === "openai") {
            const client = new openai_1.OpenAI({ apiKey: key, timeout: 10000 });
            await client.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: "hi" }],
                max_tokens: 5
            });
        }
        else {
            let baseURL;
            let model;
            switch (type) {
                case "cerebras":
                    baseURL = "https://api.cerebras.ai/v1";
                    model = "llama-3.1-70b";
                    break;
                default:
                    baseURL = "https://openrouter.ai/api/v1";
                    model = "google/gemini-2.0-flash-001";
                    break;
            }
            const client = new openai_1.OpenAI({
                apiKey: key,
                baseURL,
                timeout: 10000
            });
            await client.chat.completions.create({
                model,
                messages: [{ role: "user", content: "hi" }],
                max_tokens: 5
            });
        }
        return true;
    }
    catch (e) {
        logger_1.logger.error(`API Key validation failed (${type}): ${e.message}`);
        return false;
    }
}
async function isDuplicateAI(userId, title, content) {
    const lastTitles = await database_1.DBService.getLastTitles(userId, 50);
    if (lastTitles.length === 0)
        return false;
    // AI TEKSHIRUVI
    try {
        const res = await getSmartAIResponse(config_1.CONFIG.DEDUPLICATION_PROMPT, `POSTED TITLES:\n${lastTitles.join("\n")}\n\nNEW ITEM:\nTitle: ${title}\nContent: ${content.slice(0, 1000)}`);
        const isDup = res.toUpperCase().includes("DUPLICATE");
        if (isDup)
            logger_1.logger.info(`🚫 AI Dublikat aniqlandi (User: ${userId}): ${title.slice(0, 40)}...`);
        return isDup;
    }
    catch (err) {
        logger_1.logger.error(`Dublikat tekshirishda AI xatosi: ${err.message}`);
        return false;
    }
}
/** Vektorli qidiruv orqali dublikatni tekshirish */
async function checkSemanticDuplicate(userId, title, content) {
    try {
        const textToEmbed = `${title}\n${content.slice(0, 500)}`;
        const embedding = await getEmbedding(textToEmbed);
        if (!embedding)
            return false;
        const similar = await database_1.DBService.findSimilarNews(userId, embedding, 0.9);
        if (similar) {
            logger_1.logger.info(`🚫 Vektorli Dublikat aniqlandi (User: ${userId}, Similarity: ${Math.round(similar.similarity * 100)}%): ${title.slice(0, 40)}...`);
            return true;
        }
        // Agar dublikat bo'lmasa, vektorini saqlab qo'yamiz
        const hash = crypto_1.default.createHash('md5').update(textToEmbed).digest('hex');
        await database_1.DBService.saveEmbedding(userId, hash, embedding);
        return false;
    }
    catch (e) {
        logger_1.logger.error(`Semantic duplicate check error: ${e.message}`);
        return false;
    }
}
async function getNiceEmoji(title) {
    try {
        const res = await getSmartAIResponse("Pick one relevant emoji for this news topic. Output ONLY the emoji.", title);
        return res.trim().slice(0, 4);
    }
    catch {
        return "🔹";
    }
}
async function moderateContent(title, content) {
    // Define categories to block strictly as per user requirements
    const categories = [
        { label: 'Jinsiy zo\'ravonlik va Pornografiya', description: 'Sexual violence, sexual assault, harassment, or explicit adult content.' },
        { label: 'Diniy aqidaparastlik va Ekstremizm', description: 'Religious extremism, radicalization, promotion of jihad, or sectarian hate speech.' },
        { label: 'Terrorizm targ\'iboti', description: 'Promotion or glorification of terrorist acts, organizations, or illegal armed groups.' },
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
        const response = await getSmartAIResponse(systemPrompt, `Sarlavha: ${title}\n\nMatn: ${content.slice(0, 1500)}`);
        const trimmed = response.trim().toUpperCase();
        if (trimmed.startsWith('SAFE')) {
            return { status: 'SAFE' };
        }
        const match = trimmed.match(/BLOCKED[:\s]+(.+)/i);
        if (match) {
            return { status: 'BLOCKED', reason: match[1].trim() };
        }
        return { status: 'SAFE' };
    }
    catch (e) {
        logger_1.logger.error(`Content moderation error: ${e.message}`);
        return { status: 'SAFE' };
    }
}
async function translateToUzbek(title, content) {
    const prompt = `Translate this news to Uzbek. Keep it professional. Output JSON: {"title": "...", "content": "..."}`;
    const res = await getSmartAIResponse(prompt, `Title: ${title}\nContent: ${content}`);
    try {
        const jsonMatch = res.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        throw new Error("No JSON found in response");
    }
    catch (err) {
        logger_1.logger.error(`AI tarjima parsing xatosi: ${err.message}. Response: ${res}`);
        return { title, content };
    }
}
/** Gemini orqali matnli embedding (vektor) olish */
async function getEmbedding(text, retryCount = 0) {
    if (retryCount > 5)
        return null;
    if (activeKeys.length === 0)
        return null;
    // Embedding uchun faqat Gemini kalitlarini filtrlaymiz
    const geminiKeys = activeKeys.filter(k => k.type === 'gemini');
    if (geminiKeys.length === 0) {
        // Agar gemini bo'lmasa, OpenAI orqali urinib ko'rish mumkin (kelajakda)
        return null;
    }
    const keyObj = geminiKeys[embeddingKeyIndex % geminiKeys.length];
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
                embeddingKeyIndex++;
                return getEmbedding(text, retryCount + 1);
            }
            return null;
        }
        const data = await response.json();
        return data.embedding?.values ?? null;
    }
    catch (e) {
        logger_1.logger.error(`Embedding error: ${e.message}`);
        return null;
    }
}
// Yangilikni kategoriyalash
async function categorizeNews(title, content) {
    try {
        const res = await getSmartAIResponse(`Yangilikni FAQAT bitta kategoriya bilan belginla. Kategoriyalar: Sport, Siyosat, Iqtisodiyot, Texnologiya, Jamiyat, Madaniyat, Sog'liqni saqlash, Ta'lim, Hodisalar, Boshqa. FAQAT kategoriya nomini yoz, hech narsa qo'shma.`, `${title}\n${content.slice(0, 300)}`);
        const validCategories = ['Sport', 'Siyosat', 'Iqtisodiyot', 'Texnologiya', 'Jamiyat', 'Madaniyat', "Sog'liqni saqlash", "Ta'lim", 'Hodisalar', 'Boshqa'];
        const found = validCategories.find(c => res.includes(c));
        return found || 'Boshqa';
    }
    catch {
        return 'Boshqa';
    }
}
// Yangilik kayfiyatini aniqlash
async function analyzeSentiment(title) {
    try {
        const res = await getSmartAIResponse(`Bu yangilik sarlavhasining kayfiyatini aniqla. FAQAT bitta so'z yoz: "positive", "negative", yoki "neutral".`, title);
        const r = res.toLowerCase().trim();
        if (r.includes('positive'))
            return 'positive';
        if (r.includes('negative'))
            return 'negative';
        return 'neutral';
    }
    catch {
        return 'neutral';
    }
}
// Kunlik digest uchun top-5 yangilik tanlash
async function selectTopNews(titles) {
    if (titles.length <= 5)
        return titles;
    try {
        const list = titles.map((t, i) => `[${i}] ${t.title}`).join('\n');
        const res = await getSmartAIResponse(`Quyidagi yangiliklar ro'yxatidan eng muhim va qiziqarli 5 tasini tanla. FAQAT JSON formatida javob ber: [0, 2, 5, 8, 12] kabi indekslar.`, list);
        const match = res.match(/\[[\d,\s]+\]/);
        if (match) {
            const indices = JSON.parse(match[0]);
            return indices.slice(0, 5).map(i => titles[i]).filter(Boolean);
        }
        return titles.slice(0, 5);
    }
    catch {
        return titles.slice(0, 5);
    }
}
// Matnni ovozga o'girish uchun muqobil (Text-to-Speech via Telegram)
async function generateAudioSummary(title, content) {
    const summary = await getSmartAIResponse(`Bu yangilikni 3-4 jumlada qisqacha xulosa qil. Podcast uchun tabiiy, quloqqa yoqimli tilda yoz. O'zbek tilida.`, `${title}\n${content.slice(0, 1000)}`);
    return summary;
}
// AI Qisqa xulosa (Text summary)
async function generateSummary(title, content) {
    try {
        const summary = await getSmartAIResponse(`Siz professional jurnalistsiz. Berilgan yangilikning eng asosiy mazmunini bitta qisqa abzatsda (1-2 gapda) tushunarli qilib yozib bering. Hech qanday kirish so'zlarisiz (masalan: "Xulosa shuki") to'g'ridan to'g'ri faktni yozing. O'zbek tilida.`, `${title}\n${content.slice(0, 800)}`);
        return summary.trim();
    }
    catch {
        return "";
    }
}
// Text to Speech (Audio yaratish)
async function generateTTS(text) {
    try {
        // google-tts-api bilan base64 orqali audio olamiz
        // Matn uzun bo'lsa, qismlarga bo'lish kerak bo'lishi mumkin, lekin summary kalta (1-2 gap)
        const base64Audio = await googleTTS.getAudioBase64(text.slice(0, 200), {
            lang: 'uz', // O'zbek tili
            slow: false,
            host: 'https://translate.google.com',
            timeout: 10000,
        });
        return Buffer.from(base64Audio, 'base64');
    }
    catch (e) {
        logger_1.logger.error(`TTS Error: ${e.message}`);
        return null;
    }
}
