"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.statusCommand = void 0;
const database_1 = require("../services/database");
exports.statusCommand = {
    pattern: /status|statistika/i,
    description: '📊 Statistika va holat',
    handler: async (bot, msg) => {
        const chatId = msg.chat.id;
        const stats = await database_1.DBService.getStats(chatId);
        const user = await database_1.DBService.getUser(chatId);
        if (!user)
            return;
        const chartConfig = {
            type: 'pie',
            data: {
                labels: ['Postlar', 'Dublikatlar'],
                datasets: [{
                        data: [stats.total_posts, stats.total_duplicates],
                        backgroundColor: ['rgba(54, 162, 235, 0.8)', 'rgba(255, 99, 132, 0.8)']
                    }]
            }
        };
        const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=600&h=400`;
        const text = `📊 <b>Sizning Shaxsiy Statistikangiz</b>\n\n` +
            `📈 <b>Muvaffaqiyatli postlar:</b> ${stats.total_posts || 0}\n` +
            `♻️ <b>Ushlab qolingan dublikatlar:</b> ${stats.total_duplicates || 0}\n\n` +
            `<i>Grafikda sizning faoliyat ko'rsatkichlaringiz tasvirlangan.</i>`;
        try {
            await bot.sendPhoto(chatId, chartUrl, { caption: text, parse_mode: 'HTML' });
        }
        catch (e) {
            await bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
        }
    }
};
