"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiKeyService = exports.MANAGED_API_KEY_TYPES = void 0;
const database_1 = require("./database");
exports.MANAGED_API_KEY_TYPES = ['groq', 'cerebras', 'openrouter', 'gemini', 'openai', 'google'];
exports.ApiKeyService = {
    async listUserKeys(userId) {
        return database_1.DBService.getUserApiKeys(userId);
    },
    async addKey(userId, type, key) {
        await database_1.DBService.addApiKey(userId, key, type);
    },
    async removeKey(id) {
        await database_1.DBService.removeApiKeyById(id);
    },
    maskKey(key) {
        if (!key)
            return 'Not available';
        if (key.length <= 10)
            return `${key.slice(0, 3)}...`;
        return `${key.slice(0, 6)}...${key.slice(-4)}`;
    },
};
