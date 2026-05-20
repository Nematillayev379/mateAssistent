import { AiKeyType } from '../config/config';
import { DBService } from './database';

export const MANAGED_API_KEY_TYPES = ['groq', 'cerebras', 'openrouter', 'gemini', 'openai', 'google'] as const;

export const ApiKeyService = {
  async listUserKeys(userId: number) {
    return DBService.getUserApiKeys(userId);
  },

  async addKey(userId: number, type: AiKeyType, key: string) {
    await DBService.addApiKey(userId, key, type);
  },

  async removeKey(id: number) {
    await DBService.removeApiKeyById(id);
  },

  maskKey(key: string): string {
    if (!key) return 'Not available';
    if (key.length <= 10) return `${key.slice(0, 3)}...`;
    return `${key.slice(0, 6)}...${key.slice(-4)}`;
  },
};
