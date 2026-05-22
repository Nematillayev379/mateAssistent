import { generateSmmImage } from './ai';
import { logger } from '../utils/logger';

const BRAND_COLORS: Record<string, string> = {
  default: '22d3ee', finance: '22c55e', sport: 'ef4444', tech: '6366f1',
  culture: 'ec4899', world: 'f59e0b', economy: '22c55e',
};

const BRAND_LOGO = '📡 NewsBot';

export type VisualTemplate = 'classic' | 'modern' | 'minimal';

export const VisualBuilder = {
  async createPostImage(topic: string, category = 'default'): Promise<{ imageUrl: string; imageBase64: string | null }> {
    const color = BRAND_COLORS[category] || BRAND_COLORS.default;
    const prompt = `Professional news background, ${category} theme, dark blue gradient with ${color} accent, abstract geometric shapes, subtle grid pattern, no text, no logo, high quality, 16:9`;
    return generateSmmImage(prompt);
  },

  formatCaption(title: string, content: string, sourceUrl?: string): string {
    const escapedTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const escapedContent = content.slice(0, 500).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let caption = `<b>${escapedTitle}</b>\n\n`;
    caption += `${escapedContent}\n\n`;
    caption += `━━━━━━━━━━━━\n`;
    caption += `${BRAND_LOGO}`;
    if (sourceUrl) caption += ` · <a href="${sourceUrl}">🌐 Manba</a>`;

    return caption;
  },

  formatTrendPost(topic: string, summary: string, items: string[]): string {
    let msg = `🔥 <b>${topic.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b>\n\n`;
    for (const item of items.slice(0, 5)) {
      msg += `▫️ ${item.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n`;
    }
    msg += `\n💬 ${summary.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}\n\n`;
    msg += `━━━━━━━━━━━━\n${BRAND_LOGO}`;
    return msg;
  },
};
