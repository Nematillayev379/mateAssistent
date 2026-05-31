"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DownloadError = exports.ConfigError = exports.ValidationError = exports.TelegramError = exports.DatabaseError = exports.AppError = void 0;
exports.isAppError = isAppError;
class AppError extends Error {
    code;
    statusCode;
    constructor(message, code, statusCode = 500) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.name = this.constructor.name;
    }
}
exports.AppError = AppError;
class DatabaseError extends AppError {
    constructor(msg) { super(msg, "DB_ERROR", 500); }
}
exports.DatabaseError = DatabaseError;
class TelegramError extends AppError {
    constructor(msg) { super(msg, "TELEGRAM_ERROR", 502); }
}
exports.TelegramError = TelegramError;
class ValidationError extends AppError {
    constructor(msg) { super(msg, "VALIDATION_ERROR", 400); }
}
exports.ValidationError = ValidationError;
class ConfigError extends AppError {
    constructor(msg) { super(msg, "CONFIG_ERROR", 500); }
}
exports.ConfigError = ConfigError;
class DownloadError extends AppError {
    constructor(msg) { super(msg, "DOWNLOAD_ERROR", 502); }
}
exports.DownloadError = DownloadError;
function isAppError(err) {
    return err instanceof AppError;
}
