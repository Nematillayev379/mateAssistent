"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.hashKey = hashKey;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config/config");
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
function getEncryptionKey() {
    const secret = config_1.CONFIG.DASHBOARD_SECRET;
    if (!secret) {
        throw new Error('DASHBOARD_SECRET is required for encryption');
    }
    return crypto_1.default.createHash('sha256').update(secret).digest();
}
function encrypt(text) {
    const key = getEncryptionKey();
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${tag}:${encrypted}`;
}
function decrypt(encrypted) {
    const key = getEncryptionKey();
    const parts = encrypted.split(':');
    if (parts.length < 3)
        throw new Error('Invalid encrypted format');
    const iv = Buffer.from(parts[0], 'hex');
    const tag = Buffer.from(parts[1], 'hex');
    const data = parts.slice(2).join(':');
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}
function hashKey(key) {
    return crypto_1.default.createHash('sha256').update(key).digest('hex');
}
