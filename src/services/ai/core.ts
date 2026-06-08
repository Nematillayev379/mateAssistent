import { CONFIG, MAX_TOKENS_BY_PROVIDER } from "../../config/config";
import type { AiKeyEntry } from "../../config/config";
import { logger } from "../../utils/logger";
import { activeKeys, withKeyMutex, selectRotatingKey, blockedKeys, getKeysSortedForSmm } from "./key-pool";
import { requestAICompletion, GROQ_MODELS, type AiKeyEntryWithExclude } from "./providers";

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
  const keyWithExclude = currentKeyObj as AiKeyEntryWithExclude;

  try {
    const maxTokens = MAX_TOKENS_BY_PROVIDER[currentKeyObj.type] || CONFIG.MAX_TOKENS;
    return await requestAICompletion(currentKeyObj, system, user, maxTokens, scope === 'smm' ? 20000 : 15000, keyWithExclude._excludeModels || []);
  } catch (error: unknown) {
    const errMsg = String((error instanceof Error ? error.message : error) || '');
    const status = (error as { status?: number })?.status ?? (error as { response?: { status?: number } })?.response?.status;
    if (status === 429 || status === 401 || status === 403 || status === 503 || status === 500) {
      blockedKeys.set(currentKeyObj.key, Date.now() + 5 * 60 * 1000);
      logger.warn(`[${scope.toUpperCase()} ${currentKeyObj?.type?.toUpperCase()}] Kalit #${idx} xato berdi (${status}). Keyingisiga o'tilmoqda...`);
      return getSmartAIResponseInternal(keys, system, user, retryCount + 1, scope);
    }
    if (errMsg.includes('does not support image') || errMsg.includes('image.png')) {
      logger.warn(`[${scope.toUpperCase()}] Groq image-input error on key #${idx}. Content contains image references. Falling through.`);
      return getSmartAIResponseInternal(keys, system, user, retryCount + 1, scope);
    }
    if (currentKeyObj.type === 'groq' && (errMsg.includes('model') || errMsg.includes('decommission') || errMsg.includes('not found') || status === 400 || status === 404)) {
      const tried = keyWithExclude._excludeModels || [];
      if (tried.length < GROQ_MODELS.length - 1) {
        keyWithExclude._excludeModels = tried;
        logger.warn(`[${scope.toUpperCase()}] Groq model xatosi. Boshqa model bilan urinib ko'riladi...`);
        return getSmartAIResponseInternal(keys, system, user, retryCount + 1, scope);
      }
    }
    throw error;
  }
}

export async function getSmartAIResponse(system: string, user: string, retryCount = 0): Promise<string> {
  return getSmartAIResponseInternal(activeKeys, system, user, retryCount, 'global');
}

export async function getSmartAIResponseWithKeys(
  keys: AiKeyEntry[],
  system: string,
  user: string,
  retryCount = 0
): Promise<string> {
  return getSmartAIResponseInternal(keys, system, user, retryCount, 'smm');
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
      const data = await response.json() as Record<string, unknown>;
      const models = data.models as unknown[];
      return Array.isArray(models) && models.length > 0;
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
  } catch (e: unknown) {
    logger.error(`API Key validation failed (${type}): ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
