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
let isPriceCheckRunning = false;
function hasValidPrice(item) {
    return Number.isFinite(item.price) && item.price > 0;
}
function cleanPriceText(input) {
    const normalized = String(input || '')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const match = normalized.match(/(\d[\d\s.,]{2,})/);
    if (!match)
        return 0;
    const digits = match[1].replace(/[^\d]/g, '');
    const value = parseInt(digits, 10);
    return Number.isFinite(value) ? value : 0;
}
function absoluteUrl(base, maybeRelative) {
    if (!maybeRelative)
        return null;
    try {
        return new URL(maybeRelative, base).toString();
    }
    catch {
        return null;
    }
}
exports.PriceTrackerService = {
    async fetchPrice(url) {
        try {
            const { data } = await axios_1.default.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                timeout: 10000
            });
            const $ = cheerio.load(data);
            $('style').remove();
            $('script').remove();
            let price = 0;
            let title = '';
            if (url.includes('uzum.uz')) {
                const priceText = $('[data-test-id="item__price"]').first().text() ||
                    $('[data-testid="product-price"]').first().text() ||
                    $('[class*="price"]').first().text() ||
                    $('meta[property="product:price:amount"]').attr('content') ||
                    $('meta[itemprop="price"]').attr('content') ||
                    '';
                const titleText = $('h1.title').first().text() ||
                    $('h1[data-testid="product-title"]').first().text() ||
                    $('meta[property="og:title"]').attr('content') ||
                    $('h1').first().text();
                price = cleanPriceText(priceText);
                title = titleText.trim();
            }
            else if (url.includes('olx.uz')) {
                const priceText = $('[data-testid="ad-price-container"]').text() ||
                    $('[data-testid="ad-price"]').first().text() ||
                    $('meta[property="product:price:amount"]').attr('content') ||
                    $('meta[itemprop="price"]').attr('content') ||
                    $('h3').first().text() ||
                    '';
                const titleText = $('[data-testid="offer_title"]').text() ||
                    $('[data-testid="ad-title"]').first().text() ||
                    $('meta[property="og:title"]').attr('content') ||
                    $('h1').first().text();
                price = cleanPriceText(priceText);
                title = titleText.trim();
            }
            if (price > 0 && title) {
                return { price, title };
            }
            return null;
        }
        catch (e) {
            logger_1.logger.warn(`Price check failed for ${(0, logger_1.sanitizeLogInput)(url)}: ${e.message}`);
            return null;
        }
    },
    async searchProducts(query) {
        try {
            const [uzumResults, olxResults] = await Promise.all([
                this.searchViaDuckDuckGo('uzum.uz', query, 'Uzum'),
                this.searchViaDuckDuckGo('olx.uz', query, 'OLX'),
            ]);
            const unique = new Map();
            for (const item of [...uzumResults, ...olxResults]) {
                if (!item.url || !hasValidPrice(item))
                    continue;
                if (!unique.has(item.url))
                    unique.set(item.url, item);
            }
            return Array.from(unique.values()).sort((a, b) => a.price - b.price);
        }
        catch (e) {
            logger_1.logger.error(`Price search failed: ${e.message}`);
            return [];
        }
    },
    async searchCheapestProduct(query) {
        const results = await this.searchProducts(query);
        return results.find(hasValidPrice) ?? null;
    },
    async searchCheapestBySource(query) {
        const results = await this.searchProducts(query);
        const cheapest = new Map();
        for (const item of results) {
            const current = cheapest.get(item.source);
            if (!current || item.price < current.price)
                cheapest.set(item.source, item);
        }
        return Array.from(cheapest.values()).sort((a, b) => a.price - b.price);
    },
    async searchViaDuckDuckGo(site, query, source) {
        try {
            const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:${site} ${query}`)}`;
            const { data } = await axios_1.default.get(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 12000
            });
            const $ = cheerio.load(data);
            const links = $('.result .result__a, .web-result .result__a')
                .toArray()
                .map((elem) => {
                const href = $(elem).attr('href');
                const url = absoluteUrl('https://html.duckduckgo.com', href);
                const title = $(elem).text().trim();
                return { url, title };
            })
                .filter((item) => item.url && item.url.includes(site))
                .slice(0, 5);
            const resolved = await Promise.all(links.map(async (item) => {
                const priced = await this.fetchPrice(item.url);
                if (!priced)
                    return null;
                return {
                    title: priced.title || item.title,
                    price: priced.price,
                    url: item.url,
                    source,
                };
            }));
            return resolved.filter((item) => !!item);
        }
        catch (e) {
            logger_1.logger.warn(`${source} DDG search failed: ${e.message}`);
            return [];
        }
    },
    async runPriceChecks() {
        if (isPriceCheckRunning)
            return;
        isPriceCheckRunning = true;
        try {
            const items = await database_1.DBService.getAllTrackedPrices();
            if (!items || items.length === 0)
                return;
            logger_1.logger.info(`Narxlar tekshirilmoqda (${items.length} ta mahsulot)...`);
            for (const item of items) {
                const result = await this.fetchPrice(item.url);
                if (result) {
                    if (result.price < item.price) {
                        const diff = item.price - result.price;
                        try {
                            await (0, bot_instance_1.notify)(item.user_id, `Narx tushdi!\n\n` +
                                `${result.title}\n\n` +
                                `Eski narx: ${item.price.toLocaleString()} UZS\n` +
                                `Yangi narx: ${result.price.toLocaleString()} UZS\n\n` +
                                `Farq: -${diff.toLocaleString()} UZS\n\n` +
                                `${item.url}`, { parse_mode: 'HTML' });
                        }
                        catch (e) {
                            logger_1.logger.warn(`API call failed: ${e?.message || 'unknown error'}`);
                        }
                    }
                    else if (result.price > item.price && item.price > 0) {
                        const diff = result.price - item.price;
                        try {
                            await (0, bot_instance_1.notify)(item.user_id, `Narx oshdi!\n\n` +
                                `${result.title}\n\n` +
                                `Eski narx: ${item.price.toLocaleString()} UZS\n` +
                                `Yangi narx: ${result.price.toLocaleString()} UZS\n\n` +
                                `Farq: +${diff.toLocaleString()} UZS\n\n` +
                                `${item.url}`, { parse_mode: 'HTML' });
                        }
                        catch (e) {
                            logger_1.logger.warn(`API call failed: ${e?.message || 'unknown error'}`);
                        }
                    }
                    if (result.price !== item.price) {
                        await database_1.DBService.updatePrice(item.id, result.price);
                    }
                }
            }
        }
        finally {
            isPriceCheckRunning = false;
        }
    }
};
