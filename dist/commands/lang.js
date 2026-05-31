"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.langCommand = void 0;
const start_1 = require("./start");
exports.langCommand = {
    pattern: /^\/(lang|language|til|язык)$/i,
    description: "🌐 Tilni o'zgartirish / Change language",
    handler: async (bot, msg) => {
        const chatId = msg.chat.id;
        await (0, start_1.sendLanguageStep)(bot, chatId);
    },
};
