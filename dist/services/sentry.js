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
exports.initSentry = initSentry;
exports.captureError = captureError;
exports.captureMessage = captureMessage;
const Sentry = __importStar(require("@sentry/node"));
const logger_1 = require("../utils/logger");
const secret_manager_1 = require("./secret_manager");
let initialized = false;
function initSentry() {
    const dsn = secret_manager_1.SecretManager.get('SENTRY_DSN');
    if (!dsn) {
        logger_1.logger.info('Sentry not configured (SENTRY_DSN not set)');
        return;
    }
    try {
        Sentry.init({
            dsn,
            environment: process.env.NODE_ENV || 'production',
            tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
        });
        initialized = true;
        logger_1.logger.info('Sentry initialized');
    }
    catch (e) {
        logger_1.logger.warn(`Sentry init failed: ${e.message}`);
    }
}
function captureError(error, context) {
    if (!initialized)
        return;
    Sentry.withScope((scope) => {
        if (context)
            scope.setExtras(context);
        Sentry.captureException(error);
    });
}
function captureMessage(msg, level = 'warning') {
    if (!initialized)
        return;
    Sentry.captureMessage(msg, level);
}
exports.default = { initSentry, captureError, captureMessage };
