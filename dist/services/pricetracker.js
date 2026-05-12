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
exports.PriceTrackerService = void 0;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const logger_1 = require("../utils/logger");
const database_1 = require("./database");
const bot_instance_1 = require("./bot_instance");
exports.PriceTrackerService = {
    async fetchPrice(url) {
        try {
            const { data } = await axios_1.default.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                },
                timeout: 10000
            });
            const $ = cheerio.load(data);
            let price = 0;
            let title = "";
            if (url.includes('uzum.uz')) {
                // Basic Uzum scraper logic (HTML structure might change)
                const priceText = $('[data-test-id="item__price"]').first().text() || $('.product-price').first().text();
                const titleText = $('h1.title').first().text() || $('h1').first().text();
                price = parseInt(priceText.replace(/[^\d]/g, '')) || 0;
                title = titleText.trim();
            }
            else if (url.includes('olx.uz')) {
                // Basic OLX scraper logic
                const priceText = $('[data-testid="ad-price"]').first().text();
                const titleText = $('[data-testid="ad-title"]').first().text();
                price = parseInt(priceText.replace(/[^\d]/g, '')) || 0;
                title = titleText.trim();
            }
            if (price > 0 && title) {
                return { price, title };
            }
            return null;
        }
        catch (e) {
            logger_1.logger.warn(`Price check failed for ${url}: ${e.message}`);
            return null;
        }
    },
    async searchProducts(query) {
        try {
            // Search on Uzum.uz
            const uzumResults = await this.searchUzum(query);
            // Search on OLX.uz
            const olxResults = await this.searchOLX(query);
            return [...uzumResults, ...olxResults];
        }
        catch (e) {
            logger_1.logger.error(`Price search failed: ${e.message}`);
            return [];
        }
    },
    async searchUzum(query) {
        try {
            const searchUrl = `https://uzum.uz/search?query=${encodeURIComponent(query)}`;
            const { data } = await axios_1.default.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });
            const $ = cheerio.load(data);
            const results = [];
            // Extract product cards
            $('.product-card, [data-testid="product-card"]').each((i, elem) => {
                if (i >= 5)
                    return; // Limit to 5 results
                const title = $(elem).find('.product-title, [data-testid="product-title"]').text().trim();
                const priceText = $(elem).find('.product-price, [data-testid="product-price"]').text().trim();
                const price = parseInt(priceText.replace(/[^\d]/g, '')) || 0;
                const link = $(elem).find('a').attr('href');
                if (title && price > 0 && link) {
                    results.push({
                        title,
                        price,
                        url: link.startsWith('http') ? link : `https://uzum.uz${link}`,
                        source: 'Uzum'
                    });
                }
            });
            return results;
        }
        catch (e) {
            logger_1.logger.warn(`Uzum search failed: ${e.message}`);
            return [];
        }
    },
    async searchOLX(query) {
        try {
            const searchUrl = `https://www.olx.uz/list/q_${encodeURIComponent(query)}/`;
            const { data } = await axios_1.default.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });
            const $ = cheerio.load(data);
            const results = [];
            // Extract ad cards
            $('[data-cy="l-card"], .offer-wrapper').each((i, elem) => {
                if (i >= 5)
                    return; // Limit to 5 results
                const title = $(elem).find('h6, [data-testid="ad-title"]').text().trim();
                const priceText = $(elem).find('[data-testid="ad-price"]').text().trim();
                const price = parseInt(priceText.replace(/[^\d]/g, '')) || 0;
                const link = $(elem).find('a').attr('href');
                if (title && link && price > 0) {
                    results.push({
                        title,
                        price,
                        url: link.startsWith('http') ? link : `https://www.olx.uz${link}`,
                        source: 'OLX'
                    });
                }
            });
            return results;
        }
        catch (e) {
            logger_1.logger.warn(`OLX search failed: ${e.message}`);
            return [];
        }
    },
    async runPriceChecks() {
        const items = await database_1.DBService.getAllTrackedPrices();
        if (!items || items.length === 0)
            return;
        logger_1.logger.info(`🔍 Narxlar tekshirilmoqda (${items.length} ta mahsulot)...`);
        for (const item of items) {
            const result = await this.fetchPrice(item.url);
            if (result) {
                if (result.price < item.price) {
                    // Narx tushgan!
                    const diff = item.price - result.price;
                    try {
                        await (0, bot_instance_1.notify)(item.user_id, `📉 <b>Narx Tushdi!</b>\n\n` +
                            `📦 <b>${result.title}</b>\n\n` +
                            `💰 Eski narx: ${item.price.toLocaleString()} UZS\n` +
                            `🔥 Yangi narx: <b>${result.price.toLocaleString()} UZS</b>\n\n` +
                            `🔽 Farq: -${diff.toLocaleString()} UZS\n\n` +
                            `🔗 <a href="${item.url}">Sotib olish</a>`, { parse_mode: 'HTML' });
                    }
                    catch { }
                }
                // Always update to current price to avoid spam
                if (result.price !== item.price) {
                    await database_1.DBService.updatePrice(item.id, result.price);
                }
            }
        }
    }
};
