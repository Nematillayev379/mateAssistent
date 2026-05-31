export class AppError extends Error {
  constructor(message: string, public code: string, public statusCode = 500) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class DatabaseError extends AppError {
  constructor(msg: string) { super(msg, "DB_ERROR", 500); }
}

export class TelegramError extends AppError {
  constructor(msg: string) { super(msg, "TELEGRAM_ERROR", 502); }
}

export class ValidationError extends AppError {
  constructor(msg: string) { super(msg, "VALIDATION_ERROR", 400); }
}

export class ConfigError extends AppError {
  constructor(msg: string) { super(msg, "CONFIG_ERROR", 500); }
}

export class DownloadError extends AppError {
  constructor(msg: string) { super(msg, "DOWNLOAD_ERROR", 502); }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
