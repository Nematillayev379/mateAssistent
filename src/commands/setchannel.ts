import TelegramBot from "node-telegram-bot-api";
import { BotCommand } from "../types";
import { DBService } from "../services/database";
import { logger } from "../utils/logger";
import { i18n } from "../services/i18n";

export const setChannelCommand: BotCommand = {
  pattern: /^\/setchannel(?:\s+(.*))?$/i,
  description: '📢 Kanalni sozlash yoki o\'zgartirish / Set channel',
  handler: async (bot: TelegramBot, msg: TelegramBot.Message, match: RegExpExecArray | null) => {
    const chatId = msg.chat.id;
    const user = await DBService.getUser(chatId);
    if (!user) return;
    const lang = user.language || 'uz';

    let rawParam = (match?.[1] || '').trim();
    if (!rawParam) {
      const helperText = {
        uz: "⚠️ <b>Iltimos, target kanal nomini kiriting!</b>\n\nMasalan:\n<code>/setchannel @kanalingiz</code>\n<code>/setchannel -100123456789</code>\n\n<i>Eslatma: Botni kanalingizda administrator (admin) qilishingiz shart!</i>",
        ru: "⚠️ <b>Пожалуйста, укажите целевой канал!</b>\n\nНапример:\n<code>/setchannel @vashkanal</code>\n<code>/setchannel -100123456789</code>\n\n<i>Примечание: Бот должен быть администратором в вашем канале!</i>",
        en: "⚠️ <b>Please specify the target channel!</b>\n\nExample:\n<code>/setchannel @yourchannel</code>\n<code>/setchannel -100123456789</code>\n\n<i>Note: The bot must be an administrator in your channel!</i>",
      }[lang as 'uz' | 'ru' | 'en'] || "⚠️ Please specify target channel: <code>/setchannel @channel</code>";

      await bot.sendMessage(chatId, helperText, { parse_mode: 'HTML' });
      return;
    }

    // Auto-extract handle from Telegram t.me links
    if (rawParam.includes("t.me/")) {
      const parts = rawParam.split("t.me/");
      const handle = parts[parts.length - 1].split("/")[0].trim();
      if (handle) {
        rawParam = "@" + handle;
      }
    }

    // If clean alphanumeric handle is provided without prefix, add @
    if (!rawParam.startsWith('@') && !rawParam.startsWith('-100') && /^[a-zA-Z0-9_]{5,32}$/.test(rawParam)) {
      rawParam = "@" + rawParam;
    }

    if (!rawParam.startsWith('@') && !rawParam.startsWith('-100')) {
      const errFormat = {
        uz: "❌ <b>Noto'g'ri kanal formati!</b>\n\nKanal nomi <code>@</code> belgisi bilan boshlanishi yoki <code>-100</code> bilan boshlanadigan ID bo'lishi kerak.",
        ru: "❌ <b>Неверный формат канала!</b>\n\nИмя канала должно начинаться с <code>@</code> или быть ID, начинающимся с <code>-100</code>.",
        en: "❌ <b>Invalid channel format!</b>\n\nThe channel must start with <code>@</code> or be an ID starting with <code>-100</code>.",
      }[lang as 'uz' | 'ru' | 'en'] || "❌ Invalid format. Use @channel or -100xxx ID.";

      await bot.sendMessage(chatId, errFormat, { parse_mode: 'HTML' });
      return;
    }

    const waitMsg = await bot.sendMessage(chatId, "⏳ Checking channel administrator rights...");

    try {
      const chat = await bot.getChat(rawParam);
      const botInfo = await bot.getMe();
      const member = await bot.getChatMember(chat.id, botInfo.id);

      if (member.status === 'administrator' || member.status === 'creator') {
        const saved = await DBService.updateUser(chatId, { target_channel: rawParam });
        if (!saved) {
          await bot.editMessageText("❌ Kanalni bazaga saqlab bo'lmadi. SQL migratsiyani tekshiring.", { chat_id: chatId, message_id: waitMsg.message_id });
          return;
        }
        
        // Mark referral active if needed
        await DBService.checkAndMarkReferralActive(chatId);

        const successText = {
          uz: `✅ <b>Kanal muvaffaqiyatli bog'landi!</b>\n\nTarget kanal: <b>${rawParam}</b>\n\nEndi bot ushbu kanalga xabarlarni yuborishga tayyor.`,
          ru: `✅ <b>Канал успешно привязан!</b>\n\nЦелевой канал: <b>${rawParam}</b>\n\nТеперь бот готов публиковать сообщения в этот канал.`,
          en: `✅ <b>Channel successfully linked!</b>\n\nTarget channel: <b>${rawParam}</b>\n\nNow the bot is ready to publish messages to this channel.`,
        }[lang as 'uz' | 'ru' | 'en'] || `✅ Target channel successfully set to ${rawParam}`;

        await bot.editMessageText(successText, { chat_id: chatId, message_id: waitMsg.message_id, parse_mode: 'HTML' });
      } else {
        const notAdminText = {
          uz: "❌ <b>Bot ushbu kanalda administrator emas!</b>\n\nIltimos, avval botni kanalingizda administrator qiling va qaytadan urinib ko'ring.",
          ru: "❌ <b>Бот не является администратором в этом канале!</b>\n\nПожалуйста, сделайте бота администратором в канале и попробуйте снова.",
          en: "❌ <b>Bot is not an administrator in this channel!</b>\n\nPlease promote the bot to administrator in your channel and try again.",
        }[lang as 'uz' | 'ru' | 'en'] || "❌ Bot is not an administrator in this channel.";

        await bot.editMessageText(notAdminText, { chat_id: chatId, message_id: waitMsg.message_id, parse_mode: 'HTML' });
      }
    } catch (e: any) {
      logger.warn(`Failed to link channel ${rawParam} for user ${chatId}: ${e.message}`);
      const errText = {
        uz: `❌ <b>Kanal topilmadi yoki xatolik yuz berdi!</b>\n\nBatafsil: <i>${e.message}</i>\n\nKanal ommaviy (public) ekanligini yoki bot adminligini tekshiring.`,
        ru: `❌ <b>Канал не найден или произошла ошибка!</b>\n\nИнфо: <i>${e.message}</i>\n\nУбедитесь, что канал публичный или бот добавлен в него.`,
        en: `❌ <b>Channel not found or error occurred!</b>\n\nDetails: <i>${e.message}</i>\n\nVerify that the channel is public or the bot has access.`,
      }[lang as 'uz' | 'ru' | 'en'] || `❌ Channel verification failed: ${e.message}`;

      await bot.editMessageText(errText, { chat_id: chatId, message_id: waitMsg.message_id, parse_mode: 'HTML' });
    }
  }
};
