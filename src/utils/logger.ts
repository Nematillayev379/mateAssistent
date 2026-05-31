import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { CONFIG } from "../config/config";
import fs from "fs";
import path from "path";

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
);

// BUG-149 Fix: On ephemeral FS (Render.com), only use console transport
const isEphemeralFs = !!(process.env.RENDER || process.env.RAILWAY_ENVIRONMENT || process.env.FLY_APP_NAME);

const logDir = CONFIG.LOG_DIR || path.join(process.cwd(), "logs");

const fileTransports: winston.transport[] = [];

// BUG-149 Fix: Only create file transports if not on ephemeral filesystem
if (!isEphemeralFs) {
  try {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fileTransports.push(
      new DailyRotateFile({
        filename: `${logDir}/application-%DATE%.log`,
        datePattern: "YYYY-MM-DD",
        maxSize: "20m",
        maxFiles: "14d",
      }),
      new DailyRotateFile({
        level: "error",
        filename: `${logDir}/error-%DATE%.log`,
        datePattern: "YYYY-MM-DD",
        maxSize: "20m",
        maxFiles: "30d",
      })
    );
  } catch (_) {}
}

/** CWE-117: Strip newlines/carriage-returns/tabs from external data before logging */
export function sanitizeLogInput(value: unknown): string {
  return String(value ?? '').replace(/[\r\n\t]/g, ' ').slice(0, 500);
}

export const logger = winston.createLogger({
  level: "info",
  format: logFormat,
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        logFormat
      ),
    }),
    ...fileTransports,
  ],
});
