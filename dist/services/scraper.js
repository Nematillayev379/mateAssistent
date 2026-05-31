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
exports.ScraperService = void 0;
const axios_1 = __importDefault(require("axios"));
const axios_cookiejar_support_1 = require("axios-cookiejar-support");
const tough_cookie_1 = require("tough-cookie");
const cheerio = __importStar(require("cheerio"));
const dns_1 = __importDefault(require("dns"));
const logger_1 = require("../utils/logger");
const ai_1 = require("./ai");
const finance_1 = require("./finance");
const config_1 = require("../config/config");
const cookieJar = new tough_cookie_1.CookieJar();
const httpClient = (0, axios_cookiejar_support_1.wrapper)(axios_1.default.create({
    jar: cookieJar,
    withCredentials: true,
    timeout: 15000,
    maxRedirects: 5,
    responseType: "text",
}));
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
async function fetchWithRetry(url, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const { data } = await httpClient.get(url, { headers: { "User-Agent": USER_AGENT } });
            return data;
        }
        catch (e) {
            if (i === retries - 1)
                return "";
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
    return "";
}
function resolveUrl(value, baseUrl) {
    if (!value)
        return undefined;
    try {
        return new URL(value, baseUrl).href;
    }
    catch {
        return undefined;
    }
}
function extractImageFromHtmlFragment(fragment) {
    if (!fragment)
        return undefined;
    try {
        const $fragment = cheerio.load(fragment);
        return $fragment("img").first().attr("src") || undefined;
    }
    catch {
        return undefined;
    }
}
exports.ScraperService = {
    async scrapeArticle(url) {
        try {
            const html = await fetchWithRetry(url);
            const $ = cheerio.load(html);
            const imageCandidates = [
                $("meta[property='og:image:secure_url']").attr("content"),
                $("meta[property='og:image']").attr("content"),
                $("meta[name='twitter:image']").attr("content"),
                $("meta[name='twitter:image:src']").attr("content"),
                $("link[rel='image_src']").attr("href"),
                $("article img[src]").first().attr("src"),
                $("main img[src]").first().attr("src"),
                $(".news-text img[src], .content img[src], .article-body img[src], .post-content img[src], .entry-content img[src]").first().attr("src"),
            ];
            let imageUrl = imageCandidates.map((candidate) => resolveUrl(candidate, url)).find((candidate) => candidate && this.isMediaUrl(candidate));
            const title = $("meta[property='og:title']").attr("content") || $("h1").first().text().trim() || $("title").text().trim() || '';
            if (imageUrl === url || !this.isMediaUrl(imageUrl))
                imageUrl = undefined;
            const paragraphs = [];
            const adKeywords = config_1.CONFIG.AD_KEYWORDS.map(k => k.toLowerCase());
            const selectors = [
                "article p", ".news-text p", ".content p", ".article-body p",
                ".post-content p", ".entry-content p", "main p", ".article__text p",
                "#article-body p", ".story-body p"
            ];
            const seenParagraphs = new Set();
            $(selectors.join(", ")).each((_, p) => {
                const t = $(p).text().trim();
                const lower = t.toLowerCase();
                if (t.length > 50 && !adKeywords.some(kw => lower.includes(kw)) && !lower.includes("copyright")) {
                    if (!seenParagraphs.has(t)) {
                        seenParagraphs.add(t);
                        paragraphs.push(t);
                    }
                }
            });
            if (paragraphs.length === 0) {
                const metaDesc = $("meta[name='description']").attr("content") || $("meta[property='og:description']").attr("content");
                if (metaDesc)
                    paragraphs.push(metaDesc);
            }
            let audioUrl = resolveUrl($("enclosure[type^='audio']").attr("url") || $("a[href$='.mp3']").first().attr("href"), url);
            let videoUrl = resolveUrl($("meta[property='og:video']").attr("content") || $("enclosure[type^='video']").attr("url") || $("a[href$='.mp4']").first().attr("href"), url);
            return { title, content: paragraphs.join("\n\n"), imageUrl, audioUrl, videoUrl };
        }
        catch (e) {
            logger_1.logger.warn(`Maqolani o'qishda xato: ${(0, logger_1.sanitizeLogInput)(url)} - ${e.message}`);
            return null;
        }
    },
    isMediaUrl(url) {
        if (!url)
            return false;
        const path = url.split(/[?#]/)[0].toLowerCase();
        if (/\.(html|php|htm|asp|aspx|jsp)$/i.test(path))
            return false;
        if (/\.(jpg|jpeg|png|gif|webp|mp4|mov|m4v|mp3|ogg|wav|webm)$/i.test(path))
            return true;
        return /\/(images?|img|uploads?|media|cdn|assets?)\/[^/]+/i.test(url);
    },
    async isValidMedia(url) {
        if (!this.isMediaUrl(url))
            return false;
        try {
            // Use HEAD request instead of GET to avoid downloading the entire file
            const res = await httpClient.head(url, {
                headers: { "User-Agent": USER_AGENT },
                timeout: 5000
            });
            const contentType = String(res.headers["content-type"] || "");
            return contentType.startsWith("image/") || contentType.startsWith("video/") || contentType.startsWith("audio/");
        }
        catch {
            // Fallback to GET if HEAD fails (some servers don't support HEAD)
            try {
                const res = await httpClient.get(url, {
                    headers: { "User-Agent": USER_AGENT, "Range": "bytes=0-1024" },
                    timeout: 5000
                });
                const contentType = String(res.headers["content-type"] || "");
                return contentType.startsWith("image/") || contentType.startsWith("video/") || contentType.startsWith("audio/");
            }
            catch {
                const path = url.split(/[?#]/)[0].toLowerCase();
                return /\.(jpg|jpeg|png|mp4|mp3|m4a|webp)$/i.test(path);
            }
        }
    },
    extractLink(el, $) {
        // RSS: <link> text content
        let link = $(el).find("link").text().trim();
        if (!link.startsWith("http")) {
            // Atom: <link href="..."/>
            link = $(el).find("link").attr("href") || "";
        }
        if (!link.startsWith("http")) {
            link = $(el).find("guid").text().trim();
        }
        if (!link.startsWith("http")) {
            const idText = $(el).find("id").text().trim();
            if (idText.startsWith("http"))
                link = idText;
        }
        if (link.startsWith("http")) {
            try {
                const u = new URL(link);
                return u.origin + u.pathname + u.search;
            }
            catch {
                return link;
            }
        }
        return "";
    },
    extractMedia(el, $) {
        const descriptionHtml = $(el).find("description").text().trim() ||
            $(el).find("content\\:encoded").text().trim() ||
            $(el).find("content").text().trim();
        const inlineImage = extractImageFromHtmlFragment(descriptionHtml);
        let imageUrl = $(el).find("enclosure[type^='image']").attr("url") ||
            $(el).find("media\\:content[medium='image'], media\\:content[type^='image']").attr("url") ||
            $(el).find("media\\:thumbnail").attr("url") ||
            inlineImage;
        let videoUrl = $(el).find("enclosure[type^='video']").attr("url") ||
            $(el).find("media\\:content[medium='video'], media\\:content[type^='video']").attr("url");
        let audioUrl = $(el).find("enclosure[type^='audio']").attr("url") ||
            $(el).find("media\\:content[medium='audio'], media\\:content[type^='audio']").attr("url");
        if (imageUrl && !this.isMediaUrl(imageUrl))
            imageUrl = undefined;
        if (videoUrl && !this.isMediaUrl(videoUrl))
            videoUrl = undefined;
        if (audioUrl && !this.isMediaUrl(audioUrl))
            audioUrl = undefined;
        return { imageUrl, videoUrl, audioUrl };
    },
    async fetchRSS(url) {
        try {
            const xml = await fetchWithRetry(url);
            const $ = cheerio.load(xml, { xmlMode: true });
            const items = [];
            const entries = $("item").length ? $("item") : $("entry");
            entries.slice(0, 50).each((_, el) => {
                const title = $(el).find("title").text().trim();
                const link = this.extractLink(el, $);
                const description = $(el).find("description").text().trim() ||
                    $(el).find("summary").text().trim() ||
                    $(el).find("content").text().trim();
                const pubDate = $(el).find("pubDate").text().trim() ||
                    $(el).find("published").text().trim() ||
                    $(el).find("updated").text().trim();
                const media = this.extractMedia(el, $);
                if (title && link) {
                    items.push({
                        title,
                        link,
                        contentSnippet: description,
                        pubDate,
                        ...media
                    });
                }
            });
            return items;
        }
        catch (e) {
            logger_1.logger.error(`RSS fetch error (${(0, logger_1.sanitizeLogInput)(url)}): ${e.message}`);
            return [];
        }
    },
    async discoverRSS(websiteUrl) {
        try {
            const html = await fetchWithRetry(websiteUrl);
            const $ = cheerio.load(html);
            const rssLinks = $('link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"], link[rel="alternate"]')
                .map((_, el) => $(el).attr('href'))
                .get()
                .filter(href => href && (href.includes('rss') || href.includes('atom') || href.includes('feed') || href.endsWith('.xml')));
            if (rssLinks.length) {
                const resolved = new URL(rssLinks[0], websiteUrl).href;
                return resolved;
            }
            const commonPaths = ['/rss', '/feed', '/rss.xml', '/atom.xml', '/feed.xml'];
            for (const p of commonPaths) {
                const trial = new URL(p, websiteUrl).href;
                try {
                    const { data } = await httpClient.get(trial, { headers: { 'User-Agent': USER_AGENT }, timeout: 5000 });
                    if (data && typeof data === 'string' && (data.includes('<rss') || data.includes('<feed') || data.includes('<atom'))) {
                        return trial;
                    }
                }
                catch {
                    // ignore and continue
                }
            }
            const prompt = `Find the RSS/Atom feed URL for the website ${websiteUrl}. Respond ONLY with the full URL or say NONE.`;
            const aiResponse = await (0, ai_1.getSmartAIResponse)(prompt, websiteUrl);
            const urlMatch = aiResponse.match(/https?:\/\/[^\s]+/i);
            if (urlMatch) {
                const discovered = urlMatch[0];
                try {
                    const originalHost = new URL(websiteUrl).hostname.replace('www.', '');
                    const discoveredHost = new URL(discovered).hostname.replace('www.', '');
                    if (discoveredHost !== originalHost && !discoveredHost.endsWith('.' + originalHost)) {
                        logger_1.logger.warn(`🚫 SSRF/Phishing Protection: AI returned different domain URL: ${(0, logger_1.sanitizeLogInput)(discovered)}`);
                        return null;
                    }
                    return discovered;
                }
                catch {
                    return null;
                }
            }
        }
        catch (e) {
            logger_1.logger.warn(`discoverRSS failed for ${(0, logger_1.sanitizeLogInput)(websiteUrl)}: ${e.message}`);
        }
        return null;
    },
    async isPublicExternalUrl(url) {
        try {
            const u = new URL(url);
            const host = u.hostname.toLowerCase();
            const isIPv6 = host.startsWith('[') && host.endsWith(']');
            const normalizedHost = isIPv6 ? host.slice(1, -1) : host;
            const isPrivateAddress = (address) => {
                if (address === 'localhost' || address === '127.0.0.1' || address === '0.0.0.0' || address === '::1')
                    return true;
                if (address.startsWith('192.168.'))
                    return true;
                if (address.startsWith('10.'))
                    return true;
                if (/^172\.(1[6-9]|2\d|3[01])\./.test(address))
                    return true;
                if (address.startsWith('169.254.'))
                    return true;
                if (address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80') || address.startsWith('fe90') || address.startsWith('fea0') || address.startsWith('feb0'))
                    return true;
                return false;
            };
            if (/^[0-9.]+$/.test(normalizedHost) || /^[0-9a-f:]+$/i.test(normalizedHost)) {
                return !isPrivateAddress(normalizedHost);
            }
            const records = await dns_1.default.promises.lookup(normalizedHost, { all: true });
            if (!records || records.length === 0)
                return false;
            return records.every(record => {
                const addr = record.address.toLowerCase();
                return !isPrivateAddress(addr);
            });
        }
        catch {
            return false;
        }
    },
    /** Extract Price from Any Online Store */
    async getPrice(url) {
        try {
            const html = await fetchWithRetry(url);
            const $ = cheerio.load(html);
            let priceText = "";
            let name = $("meta[property='og:title']").attr("content") || $("title").text().split("|")[0].trim();
            let imageUrl = $("meta[property='og:image']").attr("content");
            if (url.includes("uzum.uz")) {
                priceText = $("span.currency").first().parent().text();
                name = $("h1").first().text().trim() || name;
                if (!imageUrl)
                    imageUrl = $(".ui-carousel-image img").attr("src");
            }
            else if (url.includes("olx.uz")) {
                priceText = $('h3[data-testid="ad-price"]').text();
                name = $('h4[data-testid="ad_title"]').text().trim() || name;
                if (!imageUrl)
                    imageUrl = $(".swiper-slide img").attr("src");
            }
            else {
                // Generic Extractor (JSON-LD)
                let foundLd = false;
                $('script[type="application/ld+json"]').each((_, el) => {
                    try {
                        const html = $(el).html();
                        if (!html || html.trim() === '')
                            return;
                        const data = JSON.parse(html);
                        const checkProduct = (obj) => {
                            if (obj && obj['@type'] === 'Product') {
                                if (obj.name)
                                    name = obj.name;
                                if (obj.image)
                                    imageUrl = Array.isArray(obj.image) ? obj.image[0] : obj.image;
                                if (obj.offers && obj.offers.price) {
                                    priceText = String(obj.offers.price);
                                    foundLd = true;
                                }
                            }
                        };
                        if (Array.isArray(data))
                            data.forEach(checkProduct);
                        else
                            checkProduct(data);
                    }
                    catch {
                        logger_1.logger.warn(`JSON-LD parse error`);
                    }
                });
                if (!foundLd || !priceText) {
                    logger_1.logger.info(`Using AI fallback for price extraction on ${(0, logger_1.sanitizeLogInput)(url)}`);
                    $("script, style, nav, footer, iframe, noscript").remove();
                    const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 3000);
                    const prompt = `You are a data extractor. Extract the main product name and its price in UZS from the following web page text. Respond ONLY in JSON format: {"name": "Product Name", "priceText": "120000"}. If not found, use {"name": "", "priceText": ""}`;
                    const aiResponse = await (0, ai_1.getSmartAIResponse)(prompt, bodyText);
                    try {
                        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            const parsed = JSON.parse(jsonMatch[0]);
                            name = parsed.name || name;
                            priceText = parsed.priceText || priceText;
                        }
                    }
                    catch (err) {
                        logger_1.logger.error(`AI price parsing failed: ${err.message}`);
                    }
                }
            }
            const numericString = priceText.replace(/[\s,]/g, "").replace(/\.(?=\d{3})/g, "").replace(/[^0-9.]/g, "");
            const price = parseFloat(numericString) || 0;
            if (price === 0)
                throw new Error("Kechirasiz, ushbu sahifadan narxni aniqlab bo'lmadi.");
            if (imageUrl && !imageUrl.startsWith("http")) {
                try {
                    imageUrl = new URL(imageUrl, url).href;
                }
                catch {
                    imageUrl = undefined;
                }
            }
            return { price, name, imageUrl };
        }
        catch (e) {
            logger_1.logger.error(`Price scrape failed for ${(0, logger_1.sanitizeLogInput)(url)}: ${e.message}`);
            throw e;
        }
    },
    /** Smart Search Aggregator */
    async searchProducts(query) {
        const results = [];
        // 1. OLX API
        try {
            const olxRes = await axios_1.default.get(`https://www.olx.uz/api/v1/offers/?query=${encodeURIComponent(query)}`, {
                headers: { "User-Agent": USER_AGENT },
                timeout: 10000
            });
            if (olxRes.data && olxRes.data.data) {
                for (const item of olxRes.data.data.slice(0, 4)) {
                    const priceParam = item.params?.find((p) => p.key === 'price');
                    let convertedPrice = 0;
                    if (priceParam?.value?.converted_currency === 'UZS' && priceParam?.value?.converted_value) {
                        convertedPrice = priceParam.value.converted_value;
                    }
                    else {
                        const rawPrice = parseFloat(String(priceParam?.value?.value || 0).replace(/[^0-9.]/g, "")) || 0;
                        const currency = priceParam?.value?.currency || 'UZS';
                        convertedPrice = await finance_1.FinanceService.convertToUZS(rawPrice, currency);
                    }
                    results.push({
                        store: "OLX",
                        name: item.title,
                        price: convertedPrice,
                        url: item.url,
                        image: item.photos?.[0]?.link?.replace('{width}', '600').replace('{height}', '600')
                    });
                }
            }
        }
        catch (e) {
            logger_1.logger.warn(`OLX Search failed: ${e.message}`);
        }
        // 2. Asaxiy Scraper
        try {
            const asaxiyUrl = `https://asaxiy.uz/product?key=${encodeURIComponent(query)}`;
            const html = await fetchWithRetry(asaxiyUrl);
            const $ = cheerio.load(html);
            const items = $(".product__item").slice(0, 4).get();
            for (const el of items) {
                const name = $(el).find(".product__item-title, .product__item__info-title").first().text().trim();
                const priceText = $(el).find(".product__item-price").first().text().trim();
                const url = $(el).find("a").first().attr("href");
                const image = $(el).find("img").attr("data-src") || $(el).find("img").attr("src");
                if (name && priceText && url) {
                    const rawPrice = parseFloat(priceText.replace(/[^0-9]/g, "")) || 0;
                    let currency = 'UZS';
                    const priceTextLower = priceText.toLowerCase();
                    if (priceText.includes('$') || priceTextLower.includes('u.e') || priceTextLower.includes('y.e') || priceTextLower.includes('у.е'))
                        currency = 'USD';
                    if (priceText.includes('€'))
                        currency = 'EUR';
                    const convertedPrice = await finance_1.FinanceService.convertToUZS(rawPrice, currency);
                    results.push({
                        store: "Asaxiy",
                        name,
                        price: convertedPrice,
                        url: url.startsWith("http") ? url : `https://asaxiy.uz${url}`,
                        image: image?.startsWith("http") ? image : (image ? `https://asaxiy.uz${image}` : undefined)
                    });
                }
            }
        }
        catch (e) {
            logger_1.logger.warn(`Asaxiy Search failed: ${e.message}`);
        }
        return results.sort((a, b) => a.price - b.price).filter(r => r.price > 0);
    }
};
