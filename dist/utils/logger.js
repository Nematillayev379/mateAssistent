"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const winston_1 = __importDefault(require("winston"));
const winston_daily_rotate_file_1 = __importDefault(require("winston-daily-rotate-file"));
const config_1 = require("../config/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logFormat = winston_1.default.format.combine(winston_1.default.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), winston_1.default.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`));
// BUG-149 Fix: On ephemeral FS (Render.com), only use console transport
const isEphemeralFs = !!(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME);
const logDir = config_1.CONFIG.LOG_DIR || path_1.default.join(process.cwd(), "logs");
const fileTransports = [];
// BUG-149 Fix: Only create file transports if not on ephemeral filesystem
if (!isEphemeralFs) {
    try {
        if (!fs_1.default.existsSync(logDir)) {
            fs_1.default.mkdirSync(logDir, { recursive: true });
        }
        fileTransports.push(new winston_daily_rotate_file_1.default({
            filename: `${logDir}/application-%DATE%.log`,
            datePattern: "YYYY-MM-DD",
            maxSize: "20m",
            maxFiles: "14d",
        }), new winston_daily_rotate_file_1.default({
            level: "error",
            filename: `${logDir}/error-%DATE%.log`,
            datePattern: "YYYY-MM-DD",
            maxSize: "20m",
            maxFiles: "30d",
        }));
    }
    catch (_) { }
}
exports.logger = winston_1.default.createLogger({
    level: "info",
    format: logFormat,
    transports: [
        new winston_1.default.transports.Console({
            format: winston_1.default.format.combine(winston_1.default.format.colorize(), logFormat),
        }),
        ...fileTransports,
    ],
});
