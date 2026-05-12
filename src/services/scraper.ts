import axios from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import * as cheerio from "cheerio";
import { logger } from "../utils/logger";
import { getSmartAIResponse } from "./ai";
import { FinanceService } from "./finance";

const cookieJar = new CookieJar();
const httpClient = wrapper(axios.create({
  jar: cookieJar,
  withCredentials: true,
  timeout: 15000,
  maxRedirects: 5,
  responseType: "text",
}));

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

async function fetchWithRetry(url: string, retries = 3): Promise<string> {
  for (let i = 0; i < retries; i++) {
    try {
      const { data } = await httpClient.get(url, { headers: { "User-Agent": USER_AGENT } });
      return data;
    } catch (e: any) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 2000 * (i + 1)));
    }
  }
  return "";
}

export const ScraperService = {
  async getFullArticle(url: string) {
    try {
      const html = await fetchWithRetry(url);
      const $ = cheerio.load(html);
      
      let imageUrl = $("meta[property='og:image']").attr("content") || $("meta[name='twitter:image']").attr("content");
      const title = $("meta[property='og:title']").attr("content") || $("h1").first().text().trim() || $("title").text().trim() || '';

      // Relative URLlarni absolutega o'tkazish
      if (imageUrl && !imageUrl.startsWith("http")) {
        try {
          imageUrl = new URL(imageUrl, url).href;
        } catch {
          imageUrl = undefined;
        }
      }

      // Agar rasm maqola URLi bilan bir xil bo'lsa, bu xato (HTML page)
      if (imageUrl === url || !this.isMediaUrl(imageUrl)) imageUrl = undefined;

      const paragraphs: string[] = [];
      $("article p, .news-text p, .content p, .article-body p").each((_, p) => {
        const t = $(p).text().trim();
        if (t.length > 50 && !t.toLowerCase().includes("reklama")) {
          paragraphs.push(t);
        }
      });

      // Musiqa yoki video fayllarni qidirish
      let audioUrl = $("enclosure[type^='audio']").attr("url") || $("a[href$='.mp3']").first().attr("href");
      let videoUrl = $("meta[property='og:video']").attr("content") || $("enclosure[type^='video']").attr("url") || $("a[href$='.mp4']").first().attr("href");

      // Absolutega o'tkazish
      if (audioUrl && !audioUrl.startsWith("http")) audioUrl = new URL(audioUrl, url).href;
      if (videoUrl && !videoUrl.startsWith("http")) videoUrl = new URL(videoUrl, url).href;

      return { title, content: paragraphs.join("\n\n"), imageUrl, audioUrl, videoUrl };
    } catch (e: any) {
      logger.warn(`Maqolani o'qishda xato: ${url} - ${e.message}`);
      return null;
    }
  },

  isMediaUrl(url?: string): boolean {
    if (!url) return false;
    const path = url.split(/[?#]/)[0].toLowerCase();
    if (/\.(html|php|htm|asp|aspx|jsp)$/i.test(path)) return false;
    // Allow known CDN patterns (Cloudinary, imgur, etc.) or media extensions
    if (/\.(jpg|jpeg|png|gif|webp|mp4|mov|m4v|heic|mp3|ogg|wav|webm)$/i.test(path)) return true;
    // Allow common image CDN patterns
    return /\/(images?|img|uploads?|media|cdn|assets?)\/[^/]+/i.test(url);
  },

  async isValidMedia(url: string): Promise<boolean> {
    if (!this.isMediaUrl(url)) return false;
    try {
      const res = await httpClient.get(url, { 
        headers: { "User-Agent": USER_AGENT, "Range": "bytes=0-1024" },
        timeout: 5000 
      });
      const contentType = String(res.headers["content-type"] || "");
      return contentType.startsWith("image/") || contentType.startsWith("video/") || contentType.startsWith("audio/");
    } catch {
      const path = url.split(/[?#]/)[0].toLowerCase();
      return /\.(jpg|jpeg|png|mp4|mp3|m4a|webp)$/i.test(path);
    }
  },

  extractLink(el: any, $: any): string {
    let link = $(el).find("link").text().trim();
    if (!link.startsWith("http")) {
      link = $(el).find("guid").text().trim();
    }
    
    if (link.startsWith("http")) {
      // URL ni tozalash (?utm... va boshqa qo'shimchalarni olib tashlash)
      try {
        const u = new URL(link);
        return u.origin + u.pathname; 
      } catch {
        return link;
      }
    }
    return "";
  },

  extractMedia(el: any, $: any) {
    let imageUrl = $(el).find("enclosure[type^='image']").attr("url") || 
                   $(el).find("media\\:content[medium='image']").attr("url");
    let videoUrl = $(el).find("enclosure[type^='video']").attr("url") ||
                   $(el).find("media\\:content[medium='video']").attr("url");
    let audioUrl = $(el).find("enclosure[type^='audio']").attr("url") ||
                   $(el).find("media\\:content[medium='audio']").attr("url");

    // Agar URLlar media bo'lmasa tozalaymiz
    if (imageUrl && !this.isMediaUrl(imageUrl)) imageUrl = undefined;
    if (videoUrl && !this.isMediaUrl(videoUrl)) videoUrl = undefined;
    if (audioUrl && !this.isMediaUrl(audioUrl)) audioUrl = undefined;

    return { imageUrl, videoUrl, audioUrl };
  },

  async fetchRSS(url: string): Promise<any[]> {
    try {
      const xml = await fetchWithRetry(url);
      const $ = cheerio.load(xml, { xmlMode: true });
      const items: any[] = [];

      $("item").each((_, el) => {
        const title = $(el).find("title").text().trim();
        const link = this.extractLink(el, $);
        const description = $(el).find("description").text().trim();
        const pubDate = $(el).find("pubDate").text().trim();
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
    } catch (e: any) {
      logger.error(`RSS fetch error (${url}): ${e.message}`);
      return [];
    }
  },
  /**
   * Attempt to discover an RSS feed URL from a generic website URL.
   * It checks <link rel="alternate" type="application/rss+xml"> tags,
   * then tries common RSS paths, and finally asks the AI to guess one.
   * Returns the discovered RSS URL or null if none found.
   */
  async discoverRSS(websiteUrl: string): Promise<string | null> {
    try {
      // 1. Fetch the homepage HTML
      const html = await fetchWithRetry(websiteUrl);
      const $ = cheerio.load(html);
      // 2. Look for <link> tags with RSS type
      const rssLinks = $('link[rel="alternate"][type="application/rss+xml"]')
        .map((_, el) => $(el).attr('href'))
        .get()
        .filter(Boolean) as string[];
      if (rssLinks.length) {
        // Resolve relative URLs
        const resolved = new URL(rssLinks[0], websiteUrl).href;
        return resolved;
      }
      // 3. Try common RSS endpoint patterns
      const commonPaths = ['/rss', '/feed', '/rss.xml', '/atom.xml'];
      for (const p of commonPaths) {
        const trial = new URL(p, websiteUrl).href;
        try {
          // Quick HEAD request to see if it returns XML
          const { data } = await httpClient.get(trial, { headers: { 'User-Agent': USER_AGENT }, timeout: 5000 });
          if (data && typeof data === 'string' && data.includes('<rss')) {
            return trial;
          }
        } catch {
          // ignore and continue
        }
      }
      // 4. As fallback, ask AI to locate an RSS feed for the site
      const prompt = `Find the RSS feed URL for the website ${websiteUrl}. Respond ONLY with the full URL or say NONE.`;
      const aiResponse = await getSmartAIResponse(prompt, websiteUrl);
      const urlMatch = aiResponse.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) {
        return urlMatch[0];
      }
    } catch (e: any) {
      logger.warn(`discoverRSS failed for ${websiteUrl}: ${e.message}`);
    }
    return null;
  },

  /** Extract Price from Any Online Store */
  async getPrice(url: string): Promise<{ price: number, name: string, imageUrl?: string }> {
    // ... existing implementation remains the same
    try {
      const html = await fetchWithRetry(url);
      const $ = cheerio.load(html);
      let priceText = "";
      let name = $("title").text().split("|")[0].trim();
      let imageUrl = $("meta[property='og:image']").attr("content");

      if (url.includes("uzum.uz")) {
        priceText = $("span.currency").first().parent().text();
        name = $("h1").text().trim() || name;
        if (!imageUrl) imageUrl = $(".ui-carousel-image img").attr("src");
      } else if (url.includes("olx.uz")) {
        priceText = $('h3[data-testid="ad-price"]').text();
        name = $('h4[data-testid="ad_title"]').text().trim() || name;
        if (!imageUrl) imageUrl = $(".swiper-slide img").attr("src");
      } else {
        // Generic Extractor (JSON-LD)
        let foundLd = false;
        $('script[type="application/ld+json"]').each((_, el) => {
          try {
            const data = JSON.parse($(el).html() || "");
            const checkProduct = (obj: any) => {
              if (obj && obj['@type'] === 'Product') {
                if (obj.name) name = obj.name;
                if (obj.image) imageUrl = Array.isArray(obj.image) ? obj.image[0] : obj.image;
                if (obj.offers && obj.offers.price) {
                  priceText = String(obj.offers.price);
                  foundLd = true;
                }
              }
            };
            if (Array.isArray(data)) data.forEach(checkProduct);
            else checkProduct(data);
          } catch {}
        });

        // AI Fallback if no structured data found
        if (!foundLd || !priceText) {
          logger.info(`Using AI fallback for price extraction on ${url}`);
          $("script, style, nav, footer, iframe, noscript").remove();
          const bodyText = $("body").text().replace(/\s+/g, " ").slice(0, 3000);
          
          const prompt = `You are a data extractor. Extract the main product name and its price in UZS from the following web page text. Respond ONLY in JSON format: {"name": "Product Name", "priceText": "120000"}. If not found, use {"name": "", "priceText": ""}`;
          
          const aiResponse = await getSmartAIResponse(prompt, bodyText);
          
          try {
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              name = parsed.name || name;
              priceText = parsed.priceText || priceText;
            }
          } catch (err: any) {
            logger.error(`AI price parsing failed: ${err.message}`);
          }
        }
      }

      const numericString = priceText.replace(/[\s,]/g, "").replace(/[^0-9.]/g, "");
      const price = parseFloat(numericString) || 0;
      
      if (price === 0) throw new Error("Kechirasiz, ushbu sahifadan narxni aniqlab bo'lmadi.");

      // Relative rasmlarni to'g'rilash
      if (imageUrl && !imageUrl.startsWith("http")) {
        try {
          imageUrl = new URL(imageUrl, url).href;
        } catch {
          imageUrl = undefined;
        }
      }

      return { price, name, imageUrl };
    } catch (e: any) {
      logger.error(`Price scrape failed for ${url}: ${e.message}`);
      throw e;
    }
  },

  /** Smart Search Aggregator */
  async searchProducts(query: string): Promise<any[]> {
    const results: any[] = [];
    
    // 1. OLX API
    try {
      const olxRes = await axios.get(`https://www.olx.uz/api/v1/offers/?query=${encodeURIComponent(query)}`, {
        headers: { "User-Agent": USER_AGENT },
        timeout: 10000
      });
      if (olxRes.data && olxRes.data.data) {
        for (const item of olxRes.data.data.slice(0, 4)) {
          const priceParam = item.params.find((p: any) => p.key === 'price');
          let convertedPrice = 0;
          
          if (priceParam?.value?.converted_currency === 'UZS' && priceParam?.value?.converted_value) {
            convertedPrice = priceParam.value.converted_value;
          } else {
            const rawPrice = parseFloat(String(priceParam?.value?.value || 0).replace(/[^0-9.]/g, "")) || 0;
            const currency = priceParam?.value?.currency || 'UZS';
            convertedPrice = await FinanceService.convertToUZS(rawPrice, currency);
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
    } catch (e: any) {
      logger.warn(`OLX Search failed: ${e.message}`);
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
           if (priceText.includes('$') || priceText.toLowerCase().includes('u.e') || priceText.toLowerCase().includes('y.e')) currency = 'USD';
           if (priceText.includes('€')) currency = 'EUR';

           const convertedPrice = await FinanceService.convertToUZS(rawPrice, currency);

           results.push({
             store: "Asaxiy",
             name,
             price: convertedPrice,
             url: url.startsWith("http") ? url : `https://asaxiy.uz${url}`,
             image: image?.startsWith("http") ? image : (image ? `https://asaxiy.uz${image}` : undefined)
           });
        }
      }
    } catch (e: any) {
      logger.warn(`Asaxiy Search failed: ${e.message}`);
    }

    // Sort by price (ascending)
    return results.sort((a, b) => a.price - b.price).filter(r => r.price > 0);
  }
};

