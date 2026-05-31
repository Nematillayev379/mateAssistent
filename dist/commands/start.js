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
        uz: "O'zbek 🇺🇿",
        ru: "Русский 🇷🇺",
        en: "English 🇬🇧",
        tr: "Türkçe 🇹🇷",
        de: "Deutsch 🇩🇪",
        fr: "Français 🇫🇷",
        es: "Español 🇪🇸",
        it: "Italiano 🇮🇹",
        pt: "Português 🇵🇹",
        ar: "العربية 🇸🇦",
        hi: "हिन्दी 🇮🇳",
        zh: "中文 🇨🇳",
        ja: "日本語 🇯🇵",
        ko: "한국어 🇰🇷",
        fa: "فارسی 🇮🇷",
        kk: "Қазақша 🇰🇿",
        ky: "Кыргызча 🇰🇬",
        az: "Azərbaycanca 🇦🇿",
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
    const publicBase = String(process.env.PUBLIC_URL || "").trim();
    const introUrl = /^https?:\/\/[^/]+/i.test(publicBase) ? `${publicBase.replace(/\/$/, "")}/intro/` : null;
    const inlineKeyboard = [];
    if (dashboardUrl) {
        inlineKeyboard.push([{ text: `🖥  ${i18n_1.i18n.t("menu_dashboard", { lng: lang })}`, web_app: { url: dashboardUrl } }]);
    }
    inlineKeyboard.push([
        { text: `📡 ${i18n_1.i18n.t("menu_sources", { lng: lang })}`, callback_data: "cmd_sources" },
        { text: `🧠 ${i18n_1.i18n.t("menu_studio", { lng: lang })}`, callback_data: "cmd_studio" },
    ], [
        { text: `📤 ${i18n_1.i18n.t("menu_channel", { lng: lang })}`, callback_data: "cmd_channel" },
        { text: `⚙️ ${i18n_1.i18n.t("menu_automation", { lng: lang })}`, callback_data: "cmd_automation" },
    ], [
        { text: `📊 ${i18n_1.i18n.t("menu_analytics", { lng: lang })}`, callback_data: "cmd_stats" },
        { text: `🔧 ${i18n_1.i18n.t("menu_settings", { lng: lang })}`, callback_data: "cmd_settings" },
    ], [
        { text: `❓ ${i18n_1.i18n.t("menu_help", { lng: lang })}`, callback_data: "cmd_help" },
        ...(introUrl ? [{ text: `ℹ️ ${i18n_1.i18n.t("menu_intro", { lng: lang })}`, url: introUrl }] : []),
    ]);
    if (role === "owner" || role === "admin") {
        inlineKeyboard.unshift([{ text: `👑 ${i18n_1.i18n.t("menu_admin", { lng: lang })}`, callback_data: "cmd_admin" }]);
    }
    if (role === "user" && !user.is_premium) {
        inlineKeyboard.push([{ text: `⭐ ${i18n_1.i18n.t("menu_buy_premium", { lng: lang })}`, callback_data: "buy_premium" }]);
    }
    const statusLine = user.is_premium ? "⭐ Premium" : "🆓 Free";
    const menuText = dashboardUrl
        ? `✅ <b>${i18n_1.i18n.t("onboarding_menu_ready", { lng: lang })}</b>\n\n${statusLine}`
        : `✅ <b>${i18n_1.i18n.t("onboarding_menu_ready", { lng: lang })}</b>\n\n${statusLine}\n\n<i>${i18n_1.i18n.t("no_dashboard_configured", { lng: lang })}</i>`;
    await bot.sendMessage(chatId, menuText, { parse_mode: "HTML", reply_markup: { inline_keyboard: inlineKeyboard } });
}
async function sendLanguageStep(bot, chatId) {
    const introText = `🤖 <b>${i18n_1.i18n.t("start_intro_title", { lng: "en" })}</b>\n` +
        `<i>${i18n_1.i18n.t("start_intro_subtitle", { lng: "en" })}</i>\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `⚡ <b>${i18n_1.i18n.t("start_intro_features_title", { lng: "en" })}</b>\n\n` +
        `📡 <b>${i18n_1.i18n.t("start_feature_rss_label", { lng: "en" })}</b>\n<i>${i18n_1.i18n.t("start_feature_rss", { lng: "en" })}</i>\n\n` +
        `🧠 <b>${i18n_1.i18n.t("start_feature_ai_label", { lng: "en" })}</b>\n<i>${i18n_1.i18n.t("start_feature_ai", { lng: "en" })}</i>\n\n` +
        `🎨 <b>${i18n_1.i18n.t("start_feature_image_label", { lng: "en" })}</b>\n<i>${i18n_1.i18n.t("start_feature_image", { lng: "en" })}</i>\n\n` +
        `📥 <b>${i18n_1.i18n.t("start_feature_downloader_label", { lng: "en" })}</b>\n<i>${i18n_1.i18n.t("start_feature_downloader", { lng: "en" })}</i>\n\n` +
        `📅 <b>${i18n_1.i18n.t("start_feature_scheduler_label", { lng: "en" })}</b>\n<i>${i18n_1.i18n.t("start_feature_scheduler", { lng: "en" })}</i>\n\n` +
        `📊 <b>${i18n_1.i18n.t("start_feature_analytics_label", { lng: "en" })}</b>\n<i>${i18n_1.i18n.t("start_feature_analytics", { lng: "en" })}</i>\n\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🌐 <b>${i18n_1.i18n.t("start_choose_language", { lng: "en" })}</b>`;
    await bot.sendMessage(chatId, introText, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: getLanguageKeyboard() },
    });
}
async function sendChannelStep(bot, chatId, lang) {
    await bot.sendMessage(chatId, `<b>📤 ${i18n_1.i18n.t("onboarding_step_channel", { lng: lang })}</b>\n\n` +
        `<b>${i18n_1.i18n.t("onboarding_channel_title", { lng: lang })}</b>\n\n` +
        `${i18n_1.i18n.t("onboarding_channel_body", { lng: lang })}\n\n` +
        `<code>@kanalingiz</code>  yoki  <code>-100123456789</code>`, { parse_mode: "HTML" });
}
async function sendSourceStep(bot, chatId, lang) {
    await bot.sendMessage(chatId, `<b>📡 ${i18n_1.i18n.t("onboarding_step_source", { lng: lang })}</b>\n\n` +
        `<b>${i18n_1.i18n.t("onboarding_rss_title", { lng: lang })}</b>\n\n` +
        `${i18n_1.i18n.t("onboarding_rss_body", { lng: lang })}\n\n` +
        `<i>${i18n_1.i18n.t("onboarding_rss_website_hint", { lng: lang })}</i>`, { parse_mode: "HTML" });
}
async function sendIntervalStep(bot, chatId, lang) {
    await bot.sendMessage(chatId, `<b>⏱ ${i18n_1.i18n.t("onboarding_step_interval", { lng: lang })}</b>\n\n` +
        `<b>${i18n_1.i18n.t("onboarding_interval_title", { lng: lang })}</b>\n\n` +
        `${i18n_1.i18n.t("onboarding_interval_body", { lng: lang })}`, {
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [
                [
                    { text: "15 min", callback_data: "interval_15" },
                    { text: "30 min", callback_data: "interval_30" },
                    { text: "60 min", callback_data: "interval_60" },
                ],
                [
                    { text: "120 min", callback_data: "interval_120" },
                    { text: "240 min", callback_data: "interval_240" },
                ],
            ],
        },
    });
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
    await database_1.DBService.checkAndMarkReferralActive(chatId).catch(() => { });
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
                        await database_1.DBService.setPremium(chatId, 3);
                        logger_1.logger.info(`New referral: ${chatId} invited by ${referrer.telegram_id}, 3d premium granted`);
                        try {
                            await bot.sendMessage(chatId, `🎉 <b>Referral bonus!</b>\n\nSiz do'stingiz orqali qo'shildingiz!\n<b>3 kunlik Premium</b> sovg'a sifatida berildi!`).catch(() => { });
                            const refCount = (await database_1.DBService.getReferralStats(referrer.telegram_id)).active;
                            const refLang = referrer.language || "en";
                            const refMsg = `🎉 ${i18n_1.i18n.t("referral_joined", { lng: refLang })}\n${i18n_1.i18n.t("referral_active_count", { lng: refLang })} ${refCount}`;
                            if (refCount > 0 && refCount % 10 === 0) {
                                await database_1.DBService.checkAndGivePremium(referrer.telegram_id);
                            }
                            await bot.sendMessage(referrer.telegram_id, refMsg);
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
        const requireApproval = (await database_1.DBService.getSetting("require_approval")) === "1";
        if (!requireApproval && !user.is_approved && !isOwner && user.role !== "admin" && user.role !== "owner") {
            await database_1.DBService.updateUser(chatId, { is_approved: 1 }).catch(() => { });
            user.is_approved = 1;
        }
        if (requireApproval && !user.is_approved && !isOwner && user.role !== "admin" && user.role !== "owner") {
            try {
                await bot.sendMessage(chatId, i18n_1.i18n.t("approval_pending", { lng: user.language || "uz" }));
            }
            catch {
                logger_1.logger.warn(`Failed to send approval message to ${chatId}`);
            }
            return;
        }
        await sendNextOnboardingStep(bot, chatId, user);
    },
};
