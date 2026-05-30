import { DBService } from './database';
import { getSmartAIResponse } from './ai';
import { logger } from '../utils/logger';

interface AutomationRule {
  id: number;
  userId: number;
  trigger: 'keyword' | 'source' | 'time' | 'category';
  condition: string;
  action: 'rss_search' | 'forward_to_channel' | 'add_keyword' | 'schedule_post' | 'notify';
  actionValue: string;
  isActive: boolean;
  createdAt: string;
}

export const RuleEngine = {
  async evaluateNews(news: { title: string; content: string; url: string; source?: string; category?: string; userId: number }): Promise<void> {
    const rules = await DBService.getUserRules(news.userId);
    if (!rules.length) return;

    const text = `${news.title} ${news.content || ''}`.toLowerCase();

    for (const rule of rules) {
      if (!rule.isActive) continue;
      try {
        const matched = this.matchRule(rule, text, news);
        if (matched) await this.executeAction(rule, news);
      } catch (e: any) {
        logger.warn(`Rule ${rule.id} eval error: ${e.message}`);
      }
    }
  },

  matchRule(rule: AutomationRule, text: string, news: { title: string; content: string; url: string; source?: string; category?: string }): boolean {
    switch (rule.trigger) {
      case 'keyword':
        return rule.condition.split(',').some(k => text.includes(k.trim().toLowerCase()));
      case 'source':
        return (news.source || '').toLowerCase().includes(rule.condition.toLowerCase());
      case 'category':
        return (news.category || '').toLowerCase() === rule.condition.toLowerCase();
      case 'time':
        return true;
      default:
        return false;
    }
  },

  async executeAction(rule: AutomationRule, news: { title: string; content: string; url: string; userId: number }): Promise<void> {
    switch (rule.action) {
      case 'rss_search':
        logger.info(`Rule #${rule.id}: RSS search triggered for ${news.title.slice(0, 30)}`);
        break;
      case 'add_keyword':
        await DBService.setKeywords(rule.userId, rule.actionValue);
        logger.info(`Rule #${rule.id}: keyword "${rule.actionValue}" added`);
        break;
      default:
        logger.debug(`Rule #${rule.id}: action ${rule.action} not implemented`);
    }
  },

  async suggestRules(userId: number): Promise<string[]> {
    const user = await DBService.getUser(userId);
    if (!user) return [];
    const sources = await DBService.getUserSources(userId);
    const sourceNames = sources.map(s => s.name || s.url).join(', ');

    const prompt = `Foydalanuvchi yangilik kanali uchun avtomatlashtirish qoidalarini taklif qiling.
Manbalar: ${sourceNames || "Noma'lum"}
Til: ${user.language || 'uz'}
Kanal mavzusi: ${user.target_channel || "Noma'lum"}

3 ta eng foydali IF-THEN qoidasini taklif qiling.
Har bir qoida: trigger (keyword/source/category), condition, action (rss_search/add_keyword/notify)
JSON format: [{"trigger":"keyword","condition":"dollar, valyuta","action":"rss_search","actionValue":"dollar kursi yangiliklari"}]`;

    try {
      const raw = await getSmartAIResponse('Siz avtomatlashtirish bo\'yicha mutaxassissiz. Faqat JSON qaytaring.', prompt);
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) return [];
      const suggestions = JSON.parse(match[0]);
      return Array.isArray(suggestions) ? suggestions.slice(0, 3) : [];
    } catch (e: any) {
      logger.warn(`Rule suggestion failed: ${e.message}`);
      return [];
    }
  },
};
