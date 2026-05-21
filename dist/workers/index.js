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
exports.startWorkers = startWorkers;
const queue_1 = require("../services/queue");
const logger_1 = require("../utils/logger");
const memory_queue_1 = require("../services/memory_queue");
async function startWorkers() {
    if (!(0, queue_1.isRedisAvailable)()) {
        logger_1.logger.info('ℹ️ Redis not available — starting in-memory queue workers');
        const { processArticleInline } = await Promise.resolve().then(() => __importStar(require('./scraper_worker')));
        const { DBService } = await Promise.resolve().then(() => __importStar(require('../services/database')));
        memory_queue_1.aiQueue.process(async (task) => {
            const { userId, article, lang } = task.data;
            try {
                await processArticleInline(userId, article, lang);
                if (article.url && article.title) {
                    await DBService.markSeen(userId, article.url, article.title);
                }
            }
            catch (e) {
                logger_1.logger.error(`Memory queue processing failed: ${e.message}`);
            }
        });
        logger_1.logger.info('🚀 In-memory queue workers started (concurrency=3)');
        return;
    }
    try {
        await Promise.resolve().then(() => __importStar(require('./scraper_worker')));
        await Promise.resolve().then(() => __importStar(require('./ai_worker')));
        logger_1.logger.info('🚀 Queue workers started with Redis');
    }
    catch (err) {
        logger_1.logger.warn(`⚠️ Workers failed to start: ${err.message} — falling back to inline processing`);
    }
}
