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
async function startWorkers() {
    if (!(0, queue_1.isRedisAvailable)()) {
        logger_1.logger.info('ℹ️ Redis not available — workers skipped, using inline RSS processing');
        return;
    }
    // Workers self-register when imported; guards inside each file prevent
    // Worker construction when REDIS_URL is empty.
    try {
        // CRIT-2 Fix: Use dynamic import instead of require for ESM compatibility
        await Promise.resolve().then(() => __importStar(require('./scraper_worker')));
        await Promise.resolve().then(() => __importStar(require('./ai_worker')));
        logger_1.logger.info('🚀 Queue workers started');
    }
    catch (err) {
        logger_1.logger.warn(`⚠️ Workers failed to start: ${err.message} — falling back to inline processing`);
    }
}
