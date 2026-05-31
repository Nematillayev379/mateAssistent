"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstagramService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
const PROXIES = [
    {
        name: 'ddinstagram',
        url: (u) => `https://ddinstagram.com/u/${u}`,
        parse: (html, username) => {
            const m = html.match(/property="og:url"\s+content="([^"]+)"/);
            if (!m)
                return null;
            const id = m[1].split('/p/')[1]?.split('/')[0] || m[1];
            return { id, url: m[1], title: `Instagram post from @${username}` };
        }
    },
    {
        name: 'picuki',
        url: (u) => `https://www.picuki.com/profile/${u}`,
        parse: (html, username) => {
            const m = html.match(/href="(\/media\/[^"]+)"/);
            if (!m)
                return null;
            const id = m[1].split('/').pop();
            return { id, url: `https://www.instagram.com/p/${id}/`, title: `Instagram post from @${username}` };
        }
    },
    {
        name: 'ddinstagram-direct',
        url: (u) => `https://ddinstagram.com/${u}`,
        parse: (html, username) => {
            const m = html.match(/property="og:url"\s+content="([^"]+)"/);
            if (!m)
                return null;
            const id = m[1].split('/p/')[1]?.split('/')[0] || m[1];
            return { id, url: m[1], title: `Instagram post from @${username}` };
        }
    }
];
exports.InstagramService = {
    async getLatestPost(username) {
        const clean = username.replace('@', '').trim();
        if (!clean)
            return null;
        for (const proxy of PROXIES) {
            try {
                const res = await axios_1.default.get(proxy.url(clean), {
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                    timeout: 10000,
                    responseType: 'text'
                });
                if (res.data && res.data.length > 200) {
                    const result = proxy.parse(res.data, clean);
                    if (result)
                        return result;
                }
            }
            catch (e) {
                logger_1.logger.warn(`Instagram proxy ${proxy.name} failed: ${(0, logger_1.sanitizeLogInput)(e.message)}`);
            }
        }
        return null;
    }
};
