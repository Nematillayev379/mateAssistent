import { Request } from 'express';

declare module 'express' {
  interface Request {
    authenticatedUserId?: string;
    apiUserId?: number;
  }
}
