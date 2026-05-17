"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InstagramService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
exports.InstagramService = {
    /** Get latest post from username */
    async getLatestPost(username) {
        const cleanUsername = username.replace('@', '').trim();
        const proxyUrls = [
            `https://ddinstagram.com/u/${cleanUsername}`,
            `https://www.picuki.com/profile/${cleanUsername}`,
        ];
        for (const url of proxyUrls) {
            try {
                // B-16 Fix: Add responseType: 'text' to prevent JSON parsing errors
                const res = await axios_1.default.get(url, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    timeout: 10000,
                    responseType: 'text'
                });
                // Very basic parsing for demo - in production use a better scraper
                if (url.includes('ddinstagram')) {
                    const match = res.data.match(/property="og:url"\s+content="([^"]+)"/);
                    if (match) {
                        const postUrl = match[1];
                        const id = postUrl.split('/p/')[1]?.split('/')[0] || postUrl;
                        return { id, url: postUrl, title: `Instagram post from @${cleanUsername}` };
                    }
                }
                else if (url.includes('picuki')) {
                    const match = res.data.match(/href="(\/media\/[^"]+)"/);
                    if (match) {
                        const id = match[1].split('/').pop();
                        return { id, url: `https://www.instagram.com/p/${id}/`, title: `Instagram post from @${cleanUsername}` };
                    }
                }
            }
            catch (e) {
                logger_1.logger.warn(`Instagram scrape failed for ${(0, logger_1.sanitizeLogInput)(url)}: ${e.message}`);
            }
        }
        return null;
    }
};
