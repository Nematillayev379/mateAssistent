"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisualBuilder = void 0;
const ai_1 = require("./ai");
const BRAND_COLORS = {
    default: '22d3ee', finance: '22c55e', sport: 'ef4444', tech: '6366f1',
    culture: 'ec4899', world: 'f59e0b', economy: '22c55e',
};
exports.VisualBuilder = {
    async createPostImage(topic, category = 'default') {
        const color = BRAND_COLORS[category] || BRAND_COLORS.default;
        const prompt = `Professional news background, ${category} theme, dark blue gradient with ${color} accent, abstract geometric shapes, subtle grid pattern, no text, no logo, high quality, 16:9`;
        return (0, ai_1.generateSmmImage)(prompt);
    },
    formatCaption(title, content, sourceName, sourceUrl, botUsername) {
        const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const caption = `<b>${esc(title)}</b>\n\n${esc(content).slice(0, 500)}\n\n🌐 <a href="${esc(sourceUrl || '#')}">${esc(sourceName || 'yangiliklar')}</a>\n🤖 <a href="https://t.me/${esc(botUsername || 'bot')}">@${esc(botUsername || 'bot')}</a>`;
        return caption;
    },
    formatTrendPost(topic, summary, items) {
        let msg = `🔥 <b>${topic.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b>\n\n`;
        for (const item of items.slice(0, 5)) {
            msg += `▫️ ${item.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n`;
        }
        msg += `\n💬 ${summary.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}`;
        return msg;
    },
};
