"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleOnboardingMessage = handleOnboardingMessage;
const database_1 = require("../services/database");
const scraper_1 = require("../services/scraper");
const i18n_1 = require("../services/i18n");
const start_1 = require("./start");
async function handleOnboardingMessage(bot, chatId, text, user, lang) {
    if (!user.has_seen_lang) {
        const { sendLanguageStep } = await Promise.resolve().then(() => __importStar(require("./start")));
        await sendLanguageStep(bot, chatId);
        return true;
    }
    if (!user.target_channel) {
        await handleChannelStep(bot, chatId, text, lang);
        return true;
    }
    const sources = user.target_channel ? await database_1.DBService.getUserSources(chatId) : [];
    if (user.target_channel && sources.length === 0) {
        await handleRssStep(bot, chatId, text, lang);
        return true;
    }
    if (user.target_channel && sources.length > 0 && (!user.interval_minutes || Number(user.interval_minutes) < 1)) {
        await handleIntervalStep(bot, chatId, text, lang);
        return true;
    }
    return false;
}
async function handleChannelStep(bot, chatId, text, lang) {
    let targetText = text.trim();
    if (targetText.includes("t.me/")) {
        const parts = targetText.split("t.me/");
        const handle = parts[parts.length - 1].split("/")[0].trim();
        if (handle)
            targetText = `@${handle}`;
    }
    if (!targetText.startsWith("@") && !targetText.startsWith("-100") && /^[a-zA-Z0-9_]{5,32}$/.test(targetText)) {
        targetText = `@${targetText}`;
    }
    if (!targetText.startsWith("@") && !targetText.startsWith("-100")) {
        await bot.sendMessage(chatId, i18n_1.i18n.t("setchannel_missing", { lng: lang }));
        return;
    }
    try {
        const channelChat = await bot.getChat(targetText);
        const botInfo = await bot.getMe();
        const member = await bot.getChatMember(channelChat.id, botInfo.id);
        if (member.status !== "administrator" && member.status !== "creator") {
            await bot.sendMessage(chatId, i18n_1.i18n.t("setchannel_not_admin", { lng: lang }));
            return;
        }
        const saved = await database_1.DBService.updateUser(chatId, { target_channel: targetText });
        if (!saved) {
            await bot.sendMessage(chatId, i18n_1.i18n.t("setchannel_save_failed_db", { lng: lang }));
            return;
        }
        await database_1.DBService.checkAndMarkReferralActive(chatId);
        await bot.sendMessage(chatId, i18n_1.i18n.t("setchannel_success", { lng: lang }));
        await (0, start_1.sendNextOnboardingStep)(bot, chatId);
    }
    catch {
        await bot.sendMessage(chatId, i18n_1.i18n.t("setchannel_error", { lng: lang }));
    }
}
async function handleRssStep(bot, chatId, text, lang) {
    const trimmed = text.trim();
    let websiteInput = extractUrl(trimmed);
    if (!websiteInput) {
        const compact = trimmed.replace(/\s+/g, "");
        if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(compact)) {
            websiteInput = `https://${compact}`;
        }
        else if (/^[a-zA-Z0-9-]{2,}$/.test(compact)) {
            websiteInput = `https://${compact}.uz`;
        }
    }
    if (!websiteInput) {
        await bot.sendMessage(chatId, `${i18n_1.i18n.t("onboarding_rss_body", { lng: lang })}\n\n${i18n_1.i18n.t("onboarding_rss_website_hint", { lng: lang })}`, { parse_mode: "HTML" });
        return;
    }
    if (!/^https?:\/\//i.test(websiteInput))
        websiteInput = `https://${websiteInput}`;
    if (!(await scraper_1.ScraperService.isPublicExternalUrl(websiteInput))) {
        await bot.sendMessage(chatId, i18n_1.i18n.t("err_invalid_url", { lng: lang }));
        return;
    }
    const rssUrl = isLikelyRssUrl(websiteInput) ? websiteInput : await scraper_1.ScraperService.discoverRSS(websiteInput);
    if (!rssUrl) {
        await bot.sendMessage(chatId, i18n_1.i18n.t("onboarding_rss_not_found", { lng: lang }));
        return;
    }
    const ok = await database_1.DBService.addSource(chatId, "Primary RSS", rssUrl, lang);
    if (!ok) {
        await bot.sendMessage(chatId, i18n_1.i18n.t("err_invalid_url", { lng: lang }));
        return;
    }
    await bot.sendMessage(chatId, `${i18n_1.i18n.t("quick_source_saved", { lng: lang })}\n\nRSS: ${rssUrl}`);
    await (0, start_1.sendNextOnboardingStep)(bot, chatId);
}
async function handleIntervalStep(bot, chatId, text, lang) {
    const minutes = Number(text.trim());
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
        await bot.sendMessage(chatId, i18n_1.i18n.t("quick_invalid_interval", { lng: lang }));
        return;
    }
    await database_1.DBService.updateUser(chatId, { interval_minutes: minutes });
    await bot.sendMessage(chatId, i18n_1.i18n.t("quick_interval_saved", { lng: lang }));
    await (0, start_1.sendNextOnboardingStep)(bot, chatId);
}
function extractUrl(text) {
    const match = text.match(/(https?:\/\/[^\s]+)/);
    return match ? match[0] : null;
}
function isLikelyRssUrl(url) {
    return /rss|feed|xml|atom/i.test(url);
}
