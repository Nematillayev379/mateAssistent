import winston from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { CONFIG } from "../config/config";
import fs from "fs";
import path from "path";

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
);

const logDir = CONFIG.LOG_DIR || path.join(process.cwd(), "logs");
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (_) {}

const fileTransports: winston.transport[] = [];
try {
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
