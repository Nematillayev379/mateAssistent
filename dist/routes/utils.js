"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.serveFileDownload = void 0;
const fs_1 = __importDefault(require("fs"));
const bot_instance_1 = require("../services/bot_instance");
const logger_1 = require("../utils/logger");
const serveFileDownload = async (res, filePath, filename, opts) => {
    if (opts?.notifyBot && opts.userId) {
        try {
            if (opts.notifyBot === 'video')
                await bot_instance_1.bot.sendVideo(opts.userId, filePath, { caption: '📥 WebApp orqali yuklandi' });
            else
                await bot_instance_1.bot.sendAudio(opts.userId, filePath, { caption: '🎵 WebApp orqali yuklandi' });
        }
        catch (e) {
            logger_1.logger.warn(`Bot media send skipped for ${opts.userId}: ${e.message}`);
        }
    }
    res.download(filePath, filename, (err) => {
        try {
            if (fs_1.default.existsSync(filePath))
                fs_1.default.unlinkSync(filePath);
        }
        catch (e) {
            logger_1.logger.warn(`Cleanup: ${e?.message || 'unknown error'}`);
        }
        if (err && !res.headersSent)
            res.status(500).json({ error: 'Download failed' });
    });
};
exports.serveFileDownload = serveFileDownload;
