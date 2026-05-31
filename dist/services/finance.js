"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FinanceService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = require("../utils/logger");
class FinanceService {
    static CACHE = {};
    static CACHE_TTL = 3600 * 1000; // 1 hour
    static fetchPromise = null;
    /** Fetch Rates from CBU */
    static async getRates() {
        const cacheKey = 'CBU_DATA';
        if (this.CACHE[cacheKey] && Date.now() - this.CACHE[cacheKey].timestamp < this.CACHE_TTL) {
            return this.CACHE[cacheKey].data;
        }
        if (this.fetchPromise) {
            return this.fetchPromise;
        }
        this.fetchPromise = axios_1.default.get('https://cbu.uz/uz/arkhiv-kursov-valyut/json/')
            .then(res => {
            this.CACHE[cacheKey] = { data: res.data, timestamp: Date.now() };
            this.fetchPromise = null;
            return res.data;
        })
            .catch((e) => {
            logger_1.logger.warn(`CBU API failed: ${e.message}`);
            this.fetchPromise = null;
            return [];
        });
        return this.fetchPromise;
    }
    static async getUSDRate() {
        const rates = await this.getRates();
        const usd = rates.find((v) => v.Ccy === 'USD');
        return usd ? parseFloat(usd.Rate) : 12750; // Updated fallback
    }
    static async getEURRate() {
        const rates = await this.getRates();
        const eur = rates.find((v) => v.Ccy === 'EUR');
        return eur ? parseFloat(eur.Rate) : 13800; // Updated fallback
    }
    /** Convert common currency strings to UZS numeric value */
    static async convertToUZS(value, currency) {
        if (!currency)
            return value;
        const c = currency.toUpperCase().trim();
        // USD variants: USD, $, U.E., У.Е., Y.E.
        if (c === 'USD' || c === '$' || c.startsWith('U.E') || c.startsWith('У.Е') || c.startsWith('Y.E')) {
            const rate = await this.getUSDRate();
            return Math.round(value * rate);
        }
        if (c === 'EUR' || c === '€') {
            const rate = await this.getEURRate();
            return Math.round(value * rate);
        }
        return value; // Assume UZS
    }
    /** Fetch Top Crypto Prices (BTC, ETH, TON) */
    // B-23 Fix: Add caching to prevent rate limit issues
    static async getCryptoPrices() {
        const cacheKey = 'CRYPTO_PRICES';
        if (this.CACHE[cacheKey] && Date.now() - this.CACHE[cacheKey].timestamp < this.CACHE_TTL) {
            return this.CACHE[cacheKey].data;
        }
        try {
            const res = await axios_1.default.get('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,the-open-network&vs_currencies=usd');
            const prices = {
                BTC: res.data?.bitcoin?.usd || 0,
                ETH: res.data?.ethereum?.usd || 0,
                TON: res.data?.['the-open-network']?.usd || 0
            };
            this.CACHE[cacheKey] = { data: prices, timestamp: Date.now() };
            return prices;
        }
        catch (e) {
            logger_1.logger.error(`Crypto API failed: ${e.message}`);
            return this.CACHE[cacheKey]?.data || {};
        }
    }
}
exports.FinanceService = FinanceService;
