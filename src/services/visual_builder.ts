import { generateSmmImage } from './ai';

const BRAND_COLORS: Record<string, string> = {
  default: '22d3ee', finance: '22c55e', sport: 'ef4444', tech: '6366f1',
  culture: 'ec4899', world: 'f59e0b', economy: '22c55e',
};

export const VisualBuilder = {
  async createPostImage(topic: string, category = 'default'): Promise<{ imageUrl: string; imageBase64: string | null }> {
    const color = BRAND_COLORS[category] || BRAND_COLORS.default;
    const prompt = `Professional news background, ${category} theme, dark blue gradient with ${color} accent, abstract geometric shapes, subtle grid pattern, no text, no logo, high quality, 16:9`;
    return generateSmmImage(prompt);
  },

  formatCaption(title: string, content: string, sourceName?: string, sourceUrl?: string, botUsername?: string): string {
    const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const caption = `<b>${esc(title)}</b>\n\n${esc(content).slice(0, 500)}\n\n🌐 <a href="${esc(sourceUrl || '#')}">${esc(sourceName || 'yangiliklar')}</a>\n🤖 <a href="https://t.me/${esc(botUsername || 'bot')}">@${esc(botUsername || 'bot')}</a>`;
    return caption;
  },

  formatTrendPost(topic: string, summary: string, items: string[]): string {
    let msg = `🔥 <b>${topic.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b>\n\n`;
    for (const item of items.slice(0, 5)) {
      msg += `▫️ ${item.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n`;
    }
    msg += `\n💬 ${summary.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}`;
    return msg;
  },
};
