"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RuleEngine = void 0;
const database_1 = require("./database");
const ai_1 = require("./ai");
const logger_1 = require("../utils/logger");
exports.RuleEngine = {
    async evaluateNews(news) {
        const rules = await database_1.DBService.getUserRules(news.userId);
        if (!rules.length)
            return;
        const text = `${news.title} ${news.content || ''}`.toLowerCase();
        for (const rule of rules) {
            if (!rule.isActive)
                continue;
            try {
                const matched = this.matchRule(rule, text, news);
                if (matched)
                    await this.executeAction(rule, news);
            }
            catch (e) {
                logger_1.logger.warn(`Rule ${rule.id} eval error: ${e.message}`);
            }
        }
    },
    matchRule(rule, text, news) {
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
    async executeAction(rule, news) {
        switch (rule.action) {
            case 'rss_search':
                logger_1.logger.info(`Rule #${rule.id}: RSS search triggered for ${news.title.slice(0, 30)}`);
                break;
            case 'add_keyword':
                await database_1.DBService.setKeywords(rule.userId, rule.actionValue);
                logger_1.logger.info(`Rule #${rule.id}: keyword "${rule.actionValue}" added`);
                break;
            default:
                logger_1.logger.debug(`Rule #${rule.id}: action ${rule.action} not implemented`);
        }
    },
    async suggestRules(userId) {
        const user = await database_1.DBService.getUser(userId);
        if (!user)
            return [];
        const sources = await database_1.DBService.getUserSources(userId);
        const sourceNames = sources.map(s => s.name || s.url).join(', ');
        const prompt = `Foydalanuvchi yangilik kanali uchun avtomatlashtirish qoidalarini taklif qiling.
Manbalar: ${sourceNames || "Noma'lum"}
Til: ${user.language || 'uz'}
Kanal mavzusi: ${user.target_channel || "Noma'lum"}

3 ta eng foydali IF-THEN qoidasini taklif qiling.
Har bir qoida: trigger (keyword/source/category), condition, action (rss_search/add_keyword/notify)
JSON format: [{"trigger":"keyword","condition":"dollar, valyuta","action":"rss_search","actionValue":"dollar kursi yangiliklari"}]`;
        try {
            const raw = await (0, ai_1.getSmartAIResponse)('Siz avtomatlashtirish bo\'yicha mutaxassissiz. Faqat JSON qaytaring.', prompt);
            const match = raw.match(/\[[\s\S]*\]/);
            if (!match)
                return [];
            const suggestions = JSON.parse(match[0]);
            return Array.isArray(suggestions) ? suggestions.slice(0, 3) : [];
        }
        catch (e) {
            logger_1.logger.warn(`Rule suggestion failed: ${e.message}`);
            return [];
        }
    },
};
