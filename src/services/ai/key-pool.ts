import { OpenAI } from "openai";
import Groq from "groq-sdk";
import { buildKeyPoolFromEnv, countKeysByProvider } from "../../config/config";
import type { AiKeyEntry } from "../../config/config";
import { logger } from "../../utils/logger";
import { DBService } from "../database";

export interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
}

export interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

export interface GeminiEmbeddingResponse {
  embedding?: { values?: number[] };
}

export interface GroqModelResponse {
  choices: Array<{ message?: { content?: string } }>;
}

let globalKeyIndex = 0;
const embeddingKeyIndexHolder = { value: 0 };
export const embeddingKeyIndex = embeddingKeyIndexHolder;
export let activeKeys: AiKeyEntry[] = buildKeyPoolFromEnv();
const keyLock = { promise: Promise.resolve() as Promise<void> };
const scopedKeyIndexes = new Map<string, number>();

export async function withKeyMutex<T>(fn: () => Promise<T>): Promise<T> {
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
export const groqClients = new Map<string, Groq>();
export const openaiClients = new Map<string, OpenAI>();

// Circuit Breaker for temporarily failed or rate-limited API keys
export const blockedKeys = new Map<string, number>();

function cleanupBlockedKeys(): void {
  const now = Date.now();
  for (const [key, blockedUntil] of blockedKeys.entries()) {
    if (blockedUntil < now) blockedKeys.delete(key);
  }
}

setInterval(cleanupBlockedKeys, 60_000);

export function getAvailableKeys(keys: AiKeyEntry[]): AiKeyEntry[] {
  const now = Date.now();
  const availableKeys = keys.filter((key) => {
    const blockedUntil = blockedKeys.get(key.key);
    return !blockedUntil || blockedUntil < now;
  });
  return availableKeys.length > 0 ? availableKeys : keys;
}

export async function selectRotatingKey(keys: AiKeyEntry[], scope: 'global' | 'smm'): Promise<{ key: AiKeyEntry; idx: number }> {
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
      embeddingKeyIndexHolder.value = 0;
      for (const key of groqClients.keys()) {
        if (!allKeys.find(k => k.key === key)) groqClients.delete(key);
      }
      for (const key of openaiClients.keys()) {
        const realKey = key.includes(':') ? key.split(':')[1] : key;
        if (!allKeys.find(k => k.key === realKey)) openaiClients.delete(key);
      }

      const byProvider = countKeysByProvider(activeKeys);
      logger.info(`🔄 AI Key Pool yangilandi. Jami: ${activeKeys.length} ta kalit.`, byProvider);
    } catch (e: unknown) {
      logger.error(`Key pool refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
}

export function getActiveKeyStats() {
  return {
    total: activeKeys.length,
    byProvider: countKeysByProvider(activeKeys),
  };
}

export function getKeysSortedForSmm(): AiKeyEntry[] {
  const preferred: AiKeyEntry['type'][] = ['gemini', 'google', 'openrouter', 'groq', 'cerebras', 'openai'];
  return [...activeKeys].sort(
    (a, b) => preferred.indexOf(a.type) - preferred.indexOf(b.type)
  );
}
