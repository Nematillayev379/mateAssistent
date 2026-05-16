"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusCommand = void 0;
const database_1 = require("../services/database");
exports.statusCommand = {
    // BUG-091 Fix: Require leading slash
    pattern: /\/status|\/statistika/i,
    description: '📊 Statistika va holat',
    handler: async (bot, msg) => {
        const chatId = msg.chat.id;
        const stats = await database_1.DBService.getStats(chatId);
        const user = await database_1.DBService.getUser(chatId);
        if (!user)
            return;
        // BUG-095 Fix: Limit chart data to prevent URL overflow
        const chartConfig = {
            type: 'pie',
            data: {
                labels: ['Postlar', 'Dublikatlar'],
                datasets: [{
                        data: [stats.total_posts || 0, stats.total_duplicates || 0],
                        backgroundColor: ['rgba(54, 162, 235, 0.8)', 'rgba(255, 99, 132, 0.8)']
                    }]
            }
        };
        const chartJson = JSON.stringify(chartConfig);
        // BUG-095 Fix: Only use chart URL if it's not too long
        const chartUrl = chartJson.length < 1500
            ? `https://quickchart.io/chart?c=${encodeURIComponent(chartJson)}&w=600&h=400`
            : null;
        const text = `📊 <b>Sizning Shaxsiy Statistikangiz</b>\n\n` +
            `📈 <b>Muvaffaqiyatli postlar:</b> ${stats.total_posts || 0}\n` +
            `♻️ <b>Ushlab qolingan dublikatlar:</b> ${stats.total_duplicates || 0}\n\n` +
            `<i>Grafikda sizning faoliyat ko'rsatkichlaringiz tasvirlangan.</i>`;
        // BUG-094 Fix: Graceful fallback if quickchart.io is down
        if (chartUrl) {
            try {
                await bot.sendPhoto(chatId, chartUrl, { caption: text, parse_mode: 'HTML' });
                return;
            }
            catch (e) {
                // Fallback to text-only
            }
        }
        await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
    }
};
