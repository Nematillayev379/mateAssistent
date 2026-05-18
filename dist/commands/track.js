"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackCommand = void 0;
const database_1 = require("../services/database");
const scraper_1 = require("../services/scraper");
exports.trackCommand = {
    pattern: /^\/track\s*(.*)|\/kuzatish\s*(.*)|\/manba\s*(.*)$/i,
    description: '🔔 Narx kuzatish',
    handler: async (bot, msg, match) => {
        const chatId = msg.chat.id;
        const url = (match?.[1] || match?.[2] || match?.[3])?.trim();
        if (!url) {
            const items = await database_1.DBService.getTrackedPrices(chatId);
            const list = items.length > 0
                ? items.map((i, idx) => `${idx + 1}. <a href="${i.url}">${i.item_name}</a> — ${(i.last_price || 0).toLocaleString()} UZS`).join('\n')
                : "Hozircha kuzatilayotgan tovarlar yo'q.";
            const text = `🔔 <b>Price Tracker</b>\n\n` +
                `Uzum yoki OLX dagi tovarlarni kuzating. Narx tushganda darhol xabar beramiz!\n\n` +
                `<b>Qo'shish:</b>\n<code>/track URL</code>\n\n` +
                `<b>Kuzatilayotgan tovarlar:</b>\n${list}`;
            return bot.sendMessage(chatId, text, { parse_mode: 'HTML', disable_web_page_preview: true });
        }
        // BUG-093 Fix: Error handling with user-friendly message
        try {
            await bot.sendMessage(chatId, "🔍 Narx tekshirilmoqda...");
            const result = await scraper_1.ScraperService.getPrice(url);
            if (result) {
                await database_1.DBService.addTrackedPrice(chatId, url, result.name, result.price);
                await bot.sendMessage(chatId, `✅ <b>Tovar kuzatuvga olindi!</b>\n\n📦 ${result.name}\n💰 Boshlang'ich narx: <b>${result.price.toLocaleString()} UZS</b>`, { parse_mode: 'HTML' });
            }
        }
        catch (e) {
            await bot.sendMessage(chatId, `❌ Xato: ${e.message}`);
        }
    }
};
