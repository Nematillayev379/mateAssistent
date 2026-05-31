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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerMediaRoutes = registerMediaRoutes;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const database_1 = require("../../services/database");
const bot_instance_1 = require("../../services/bot_instance");
const logger_1 = require("../../utils/logger");
const music_1 = require("../../services/music");
const auth_1 = require("../../middleware/auth");
const i18n_1 = require("../../services/i18n");
const util_1 = require("util");
const child_process_1 = require("child_process");
const utils_1 = require("../utils");
function getLang(user) {
    return typeof user?.language === 'string' && user.language.trim() ? user.language.trim() : 'uz';
}
function registerMediaRoutes(app) {
    const mediaAiLimiter = (0, express_rate_limit_1.default)({
        windowMs: 60 * 1000,
        max: async (req) => {
            const userId = req.headers['x-user-id'] || req.query.userId || req.body?.userId;
            if (userId)
                return (await database_1.DBService.isPremiumActive(parseInt(userId))) ? 30 : 10;
            return 10;
        },
        message: { error: i18n_1.i18n.t('ai_request_limit_exceeded', { lng: 'en' }) }
    });
    app.get('/api/music/search', auth_1.checkAuth, async (req, res) => res.json(await music_1.MusicService.getYouTubeVideoIds(req.query.q, 8)));
    app.get('/api/music/download/:id', auth_1.checkAuth, async (req, res) => {
        const videoId = req.params.id;
        const userId = parseInt(req.authenticatedUserId);
        const userData = await database_1.DBService.getUser(userId);
        const lang = getLang(userData);
        if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId))
            return res.status(400).json({ error: i18n_1.i18n.t('invalid_video_id', { lng: lang }) });
        const webOnly = req.query.web === '1';
        const sendToChannel = req.query.send === '1';
        async function serveFromPath(filePath, titleHint) {
            if (sendToChannel) {
                const target = userData?.target_channel;
                if (!target)
                    return res.status(400).json({ success: false, error: i18n_1.i18n.t('target_channel_not_configured', { lng: lang }) });
                await bot_instance_1.bot.sendAudio(target, filePath);
                try {
                    if (fs_1.default.existsSync(filePath))
                        fs_1.default.unlinkSync(filePath);
                }
                catch { }
                logger_1.logger.info(`Music sent to channel ${target} for user ${userId}`);
                return res.json({ success: true, message: i18n_1.i18n.t('music_sent_to_channel', { lng: lang }) });
            }
            const ext = path_1.default.extname(filePath) || '.mp3';
            const filename = `${titleHint || `music_${videoId}`}${ext}`;
            await (0, utils_1.serveFileDownload)(res, filePath, filename, { userId, notifyBot: webOnly ? undefined : 'audio' });
        }
        try {
            const { downloadYouTube } = await Promise.resolve().then(() => __importStar(require('../../services/youtube')));
            const filePath = await downloadYouTube(`https://youtube.com/watch?v=${videoId}`, 'audio');
            await serveFromPath(filePath);
        }
        catch (e) {
            logger_1.logger.warn(`Music download failed for ${videoId}: ${e.message}`);
            // Title-based fallback: if direct video extraction fails, try a local audio search by title.
            try {
                const oembed = await Promise.resolve().then(() => __importStar(require('axios'))).then((m) => m.default.get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, {
                    timeout: 10000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                }));
                const title = String(oembed.data?.title || '').trim();
                if (title) {
                    const [fallbackMusic] = await music_1.MusicService.searchAndDownload(title, 1);
                    if (fallbackMusic?.path) {
                        logger_1.logger.info(`Music title fallback succeeded for ${videoId}: ${title}`);
                        await serveFromPath(fallbackMusic.path, fallbackMusic.title || title);
                        return;
                    }
                }
            }
            catch (fallbackErr) {
                logger_1.logger.warn(`Music title fallback failed for ${videoId}: ${fallbackErr.message}`);
            }
            // Channel delivery fallback: try direct Cobalt URL only when sending to a channel.
            if (sendToChannel) {
                try {
                    const target = userData?.target_channel;
                    if (!target)
                        return res.status(400).json({ success: false, error: i18n_1.i18n.t('target_channel_not_configured', { lng: lang }) });
                    const { DownloaderService } = await Promise.resolve().then(() => __importStar(require('../../services/downloader')));
                    const directAudioUrl = await DownloaderService.getCobaltMedia(`https://youtube.com/watch?v=${videoId}`, { audioOnly: true });
                    if (directAudioUrl) {
                        await bot_instance_1.bot.sendAudio(target, directAudioUrl);
                        logger_1.logger.info(`Music sent to channel via direct fallback ${target} for user ${userId}`);
                        return res.json({ success: true, message: i18n_1.i18n.t('music_sent_to_channel', { lng: lang }) });
                    }
                }
                catch (fallbackErr) {
                    logger_1.logger.warn(`Music direct fallback failed for ${videoId}: ${fallbackErr.message}`);
                }
            }
            res.status(502).json({ error: e.message || i18n_1.i18n.t('music_download_failed', { lng: lang }) });
        }
    });
    app.post('/api/media/download', auth_1.checkAuth, async (req, res) => {
        const { url, type } = req.body;
        const userId = parseInt(req.authenticatedUserId);
        const userData = await database_1.DBService.getUser(userId);
        const lang = getLang(userData);
        const webOnly = req.query.web === '1' || req.body?.delivery === 'web';
        if (!['video', 'audio'].includes(type))
            return res.status(400).json({ error: i18n_1.i18n.t('invalid_media_type', { lng: lang }) });
        if (!url || typeof url !== 'string')
            return res.status(400).json({ error: i18n_1.i18n.t('invalid_media_url', { lng: lang }) });
        try {
            const { downloadYouTube } = await Promise.resolve().then(() => __importStar(require('../../services/youtube')));
            const filePath = await downloadYouTube(url, type);
            const ext = path_1.default.extname(filePath) || (type === 'video' ? '.mp4' : '.mp3');
            const filename = `media_${Date.now()}${ext}`;
            await (0, utils_1.serveFileDownload)(res, filePath, filename, { userId, notifyBot: webOnly ? undefined : (type === 'video' ? 'video' : 'audio') });
        }
        catch (e) {
            logger_1.logger.warn(`Media download failed: ${e.message}`);
            res.status(502).json({ error: e.message || i18n_1.i18n.t('media_download_failed', { lng: lang }) });
        }
    });
    app.get('/api/debug/ytdlp', auth_1.checkAuth, async (req, res) => {
        try {
            const { resolveYtDlpPath } = await Promise.resolve().then(() => __importStar(require('../../utils/ytdlp')));
            const ytdlpPath = await resolveYtDlpPath();
            res.json({
                ytdlpPath,
                fsExists: ytdlpPath ? fs_1.default.existsSync(ytdlpPath) : false,
                size: ytdlpPath && fs_1.default.existsSync(ytdlpPath) ? fs_1.default.statSync(ytdlpPath).size : 0,
                version: ytdlpPath ? (await (0, util_1.promisify)(child_process_1.exec)((ytdlpPath.includes(' ') || ytdlpPath.includes('\\') ? `"${ytdlpPath}"` : ytdlpPath) + ' --version', { timeout: 5000 }).then(r => r.stdout.trim()).catch(() => 'error')) : 'not found',
                cwd: process.cwd(),
            });
        }
        catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/ai/voice-news', auth_1.checkAuth, mediaAiLimiter, async (req, res) => {
        const uid = parseInt(req.authenticatedUserId);
        const { text, title, sendToChannel } = req.body;
        const user = await database_1.DBService.getUser(uid);
        const lang = getLang(user);
        if (!user)
            return res.status(404).json({ error: i18n_1.i18n.t('media_not_found', { lng: lang }) });
        const cleanTitle = typeof title === 'string' ? title.trim() : '';
        const cleanText = typeof text === 'string' ? text.trim() : '';
        if (!cleanTitle && !cleanText)
            return res.status(400).json({ error: i18n_1.i18n.t('voice_news_empty', { lng: lang }) });
        const { generateAudioSummary, generateTTS } = await Promise.resolve().then(() => __importStar(require('../../services/ai')));
        const script = cleanText || await generateAudioSummary(cleanTitle || 'Yangilik', cleanText || cleanTitle || '', lang);
        const audio = await generateTTS(script, lang);
        if (!audio)
            return res.status(500).json({ error: i18n_1.i18n.t('voice_generation_failed', { lng: lang }) });
        const caption = `AI Voice News: <b>${cleanTitle || 'AI Ovoz Yangilik'}</b>\n\n${script.slice(0, 500)}`;
        const targets = sendToChannel ? database_1.DBService.getUserOutputChannels(user) : [uid];
        let sentCount = 0;
        for (const ch of targets) {
            try {
                await bot_instance_1.bot.sendAudio(sendToChannel ? ch : uid, audio, { caption, parse_mode: 'HTML' }, { filename: 'voice-news-file.mp3', contentType: 'audio/mpeg' });
                sentCount++;
            }
            catch (e) {
                logger_1.logger.warn(`Voice send failed ${ch}: ${e.message}`);
            }
        }
        if (sentCount === 0)
            return res.status(502).json({ error: i18n_1.i18n.t('voice_send_failed', { lng: lang }) });
        res.json({ success: true, sent: sentCount, script: script.slice(0, 800) });
    });
}
