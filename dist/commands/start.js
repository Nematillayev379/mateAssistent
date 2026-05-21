"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCommand = void 0;
exports.sendLanguageStep = sendLanguageStep;
exports.sendNextOnboardingStep = sendNextOnboardingStep;
const database_1 = require("../services/database");
const config_1 = require("../config/config");
const bot_instance_1 = require("../services/bot_instance");
const i18n_1 = require("../services/i18n");
const logger_1 = require("../utils/logger");
function getLanguageKeyboard() {
    const labels = {
        uz: "O'zbek",
        ru: "Russian",
        en: "English",
        tr: "Turkish",
        de: "Deutsch",
        fr: "French",
        es: "Spanish",
        it: "Italiano",
        pt: "Portuguese",
        ar: "Arabic",
        hi: "Hindi",
        zh: "Chinese",
        ja: "Japanese",
        ko: "Korean",
        fa: "Persian",
    };
    const rows = [];
    for (let i = 0; i < i18n_1.WEBAPP_LANGS.length; i += 2) {
        rows.push(i18n_1.WEBAPP_LANGS.slice(i, i + 2).map((lang) => ({
            text: labels[lang],
            callback_data: `setlang_${lang}`,
        })));
    }
    return rows;
}
async function sendWelcomeMenu(bot, chatId, user, role) {
    const lang = user.language || "uz";
    const dashboardUrl = (0, bot_instance_1.buildDashboardUrl)(chatId);
    const inline_keyboard = [];
    if (dashboardUrl) {
        inline_keyboard.push([{ text: i18n_1.i18n.t("menu_dashboard", { lng: lang }), web_app: { url: dashboardUrl } }], [{ text: "Web3 App (Browser)", url: dashboardUrl }]);
    }
    inline_keyboard.push([
        { text: i18n_1.i18n.t("menu_sources", { lng: lang }), callback_data: "cmd_sources" },
        { text: i18n_1.i18n.t("menu_studio", { lng: lang }), callback_data: "cmd_studio" },
    ], [
        { text: i18n_1.i18n.t("menu_channel", { lng: lang }), callback_data: "cmd_channel" },
        { text: i18n_1.i18n.t("menu_automation", { lng: lang }), callback_data: "cmd_automation" },
    ], [
        { text: i18n_1.i18n.t("menu_analytics", { lng: lang }), callback_data: "cmd_stats" },
        { text: i18n_1.i18n.t("menu_settings", { lng: lang }), callback_data: "cmd_settings" },
    ], [{ text: i18n_1.i18n.t("menu_help", { lng: lang }), callback_data: "cmd_help" }]);
    if (role === "owner" || role === "admin") {
        inline_keyboard.unshift([{ text: i18n_1.i18n.t("menu_admin", { lng: lang }), callback_data: "cmd_admin" }]);
    }
    if (role === "user" && !user.is_premium) {
        inline_keyboard.push([{ text: i18n_1.i18n.t("menu_buy_premium", { lng: lang }), callback_data: "buy_premium" }]);
    }
    const menuText = dashboardUrl
        ? i18n_1.i18n.t("onboarding_menu_ready", { lng: lang })
        : `${i18n_1.i18n.t("onboarding_menu_ready", { lng: lang })}\n\nDashboard hozircha ulanmagan. Admin PUBLIC_URL ni sozlashi kerak.`;
    await bot.sendMessage(chatId, menuText, {
        reply_markup: { inline_keyboard },
    });
}
async function sendLanguageStep(bot, chatId) {
    const premiumIntro = `\u{1F916} <b>mateAssistent Creator Console</b>\n` +
        `<i>The Ultimate Web3 Automator for Telegram Creators</i>\n\n` +
        `\u26A1\ufe0f <b>Core Automation Features:</b>\n` +
        `\u2022 \u{1F4E1} <b>RSS Feed Aggregator:</b> Auto-publish from website feeds.\n` +
        `\u2022 \u{1F9E0} <b>Smart AI Post Engine:</b> Auto-translate, summarize, and add emojis.\n` +
        `\u2022 \u{1F3A8} <b>AI Image Studio:</b> Create stunning high-res matching illustrations.\n` +
        `\u2022 \u{1F4E5} <b>Universal Downloader:</b> Fetch social videos/audio in high quality.\n` +
        `\u2022 \u{1F4D3} <b>Scheduler & Cadence:</b> Smart queuing and customized interval times.\n` +
        `\u2022 \u{1F4CA} <b>Real-time Analytics:</b> Track click rates, duplicates, and top categories.\n\n` +
        `\u{1F310} <b>Choose your language to start / Tilni tanlang / \u0412\u044b\u0431\u0435\u0440\u0438\u0442\u0435 \u044f\u0437\u044b\u043a:</b>`;
    await bot.sendMessage(chatId, premiumIntro, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: getLanguageKeyboard() }
    });
}
async function sendChannelStep(bot, chatId, lang) {
    await bot.sendMessage(chatId, `${i18n_1.i18n.t("onboarding_channel_title", { lng: lang })}\n\n${i18n_1.i18n.t("onboarding_channel_body", { lng: lang })}`);
}
async function sendSourceStep(bot, chatId, lang) {
    await bot.sendMessage(chatId, `${i18n_1.i18n.t("onboarding_rss_title", { lng: lang })}\n\n${i18n_1.i18n.t("onboarding_rss_body", { lng: lang })}`);
}
async function sendIntervalStep(bot, chatId, lang) {
    await bot.sendMessage(chatId, `${i18n_1.i18n.t("onboarding_interval_title", { lng: lang })}\n\n${i18n_1.i18n.t("onboarding_interval_body", { lng: lang })}`);
}
async function sendNextOnboardingStep(bot, chatId, userOverride) {
    const user = userOverride || (await database_1.DBService.getUser(chatId));
    if (!user)
        return "language";
    const lang = user.language || "uz";
    const sources = await database_1.DBService.getUserSources(chatId);
    if (!user.has_seen_lang) {
        await sendLanguageStep(bot, chatId);
        return "language";
    }
    if (!user.target_channel) {
        await sendChannelStep(bot, chatId, lang);
        return "channel";
    }
    if (!sources.length) {
        await sendSourceStep(bot, chatId, lang);
        return "source";
    }
    if (!user.interval_minutes || Number(user.interval_minutes) < 1) {
        await sendIntervalStep(bot, chatId, lang);
        return "interval";
    }
    await sendWelcomeMenu(bot, chatId, user, user.role || "user");
    return "menu";
}
exports.startCommand = {
    pattern: /\/start\s*(.*)|\/boshlash\s*(.*)|\/\u043d\u0430\u0447\u0430\u0442\u044c\s*(.*)/i,
    description: "Botni boshlash / Start",
    handler: async (bot, msg, match) => {
        const chatId = msg.chat.id;
        const isOwner = (0, config_1.isOwnerId)(chatId);
        const payload = (match?.[1] || match?.[2] || match?.[3] || "").trim();
        if (payload && payload.startsWith("ref_")) {
            const referrerCode = payload.replace("ref_", "").trim();
            const referrer = await database_1.DBService.getUserByReferralCode(referrerCode);
            if (referrer && referrer.telegram_id !== chatId) {
                const isNewUser = !(await database_1.DBService.getUser(chatId));
                if (isNewUser) {
                    const created = await database_1.DBService.createReferral(referrer.telegram_id, chatId);
                    if (created) {
                        logger_1.logger.info(`New referral: ${chatId} invited by ${referrer.telegram_id}`);
                        try {
                            await bot.sendMessage(referrer.telegram_id, "New referral joined from your link.");
                        }
                        catch (e) {
                            logger_1.logger.warn(`Could not notify referrer ${referrer.telegram_id}: ${e.message}`);
                        }
                    }
                }
            }
        }
        const user = await database_1.DBService.upsertUser(chatId, isOwner ? 1 : 0, msg.from?.username, msg.from?.first_name);
        if (!user)
            return;
        if (isOwner && user.role !== "owner") {
            await database_1.DBService.updateUserRole(chatId, "owner");
            user.role = "owner";
        }
        if (!user.is_approved && !isOwner && user.role !== "admin" && user.role !== "owner") {
            await bot.sendMessage(chatId, "Your profile is waiting for approval. An admin can unlock access soon.");
            return;
        }
        await sendNextOnboardingStep(bot, chatId, user);
    },
};
