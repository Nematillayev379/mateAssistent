import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'mateAssistent API',
      version: '2.0.0',
      description: 'AI-powered Telegram RSS bot with Web3 dashboard',
      contact: {
        name: 'mateAssistent',
        url: 'https://t.me/mateAssistent_bot',
      },
    },
    servers: [
      { url: process.env.PUBLIC_URL || 'http://localhost:3000', description: 'Production' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-bot-token',
          description: 'Dashboard token (obtained via /api/auth/verify)',
        },
        sessionAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: 'rss_sid',
          description: 'Session cookie (obtained via /api/auth/session)',
        },
        apiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'Public API key',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
        Success: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            telegram_id: { type: 'number' },
            username: { type: 'string' },
            first_name: { type: 'string' },
            role: { type: 'string', enum: ['owner', 'admin', 'user', 'premium'] },
            is_premium: { type: 'boolean' },
            target_channel: { type: 'string' },
            language: { type: 'string' },
          },
        },
        Source: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            name: { type: 'string' },
            url: { type: 'string' },
            lang: { type: 'string' },
          },
        },
        PremiumInfo: {
          type: 'object',
          properties: {
            monthlyPrice: { type: 'number' },
            yearlyPrice: { type: 'number' },
            starsPrice: { type: 'number' },
            isActive: { type: 'boolean' },
            expiresAt: { type: 'string', nullable: true },
            benefits: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    security: [
      { bearerAuth: [] },
      { sessionAuth: [] },
    ],
  },
  apis: [path.join(__dirname, '../handlers/api/*.ts'), path.join(__dirname, '../handlers/*.ts')],
};

export const swaggerSpec = swaggerJsdoc(options);
