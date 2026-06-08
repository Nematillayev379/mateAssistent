# mateAssistent

AI-powered Telegram RSS bot with Web3 dashboard, crypto payments, and multi-provider AI.

## Features

- **RSS Auto-Post** — Fetches news every 2 minutes, AI-summarizes, posts to channels
- **AI Summarization** — Multi-provider (Groq, Gemini, OpenAI, Cerebras, OpenRouter) with smart deduplication
- **Web3 Dashboard** — Dark-themed dashboard with TON Connect wallet, crypto payments
- **Scheduled Posts** — Schedule posts for specific times with interval-based distribution
- **Media Download** — YouTube, TikTok, Instagram via yt-dlp
- **TTS (Text-to-Speech)** — Google Translate TTS + Edge TTS fallback
- **Content Moderation** — AI-powered content safety checks
- **Analytics** — Post tracking, engagement metrics, Chart.js visualizations
- **Multi-Language** — 15-language i18n support

## Tech Stack

- **Backend**: Node.js + TypeScript + Express
- **Bot**: node-telegram-bot-api
- **Database**: Supabase (PostgreSQL)
- **Cache**: Redis (optional, falls back to in-memory)
- **AI**: Groq, Gemini, OpenAI, Cerebras, OpenRouter
- **Payments**: Telegram Stars, TON, USDT, Payme, Click
- **Deploy**: Docker + Render

## Quick Start

### Environment Variables

Copy `.env.example` to `.env` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_TOKEN` | Yes | Telegram bot token from @BotFather |
| `DASHBOARD_SECRET` | Yes | Dashboard auth secret (`openssl rand -hex 32`) |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_KEY` | Yes | Supabase anon key |
| `GROQ_KEYS` | No* | Groq API keys (comma-separated) |
| `GEMINI_KEYS` | No* | Gemini API keys |
| `OWNER_ID` | No | Telegram user ID for admin access |
| `PUBLIC_URL` | No | Public URL for webhooks |

*At least one AI provider key is required.

### Development

```bash
npm install
npm run dev
```

### Production

```bash
npm run build
npm start
```

### Docker

```bash
docker-compose up -d
```

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check |
| POST | `/api/auth/telegram` | None | Telegram WebApp login |
| GET | `/api/dashboard-info` | Session | Dashboard data |
| GET | `/api/overview/:userId` | Token | Overview stats |
| POST | `/api/ai/smm` | Token | Generate SMM post |
| GET | `/api/sources/:userId` | Token | List RSS sources |
| POST | `/api/sources/:userId` | Token | Add RSS source |
| GET | `/api/scheduled/:userId` | Token | Scheduled posts |
| POST | `/api/premium/buy` | Token | Buy premium |

## Project Structure

```
src/
├── commands/       # Bot command handlers
├── config/         # Configuration and environment
├── crons/          # Cron job definitions
├── errors/         # Error handling
├── handlers/       # Express route handlers
│   └── api/        # API endpoint handlers
├── jobs/           # Background job processors
├── repositories/   # Database access layer
├── services/       # Business logic (34 modules)
│   ├── ai/         # AI provider abstraction
│   ├── database.ts # Supabase client
│   ├── redis.ts    # Redis connection pool
│   └── ...
├── types/          # TypeScript type definitions
├── utils/          # Utility functions
└── workers/        # Worker processes
public/
├── dashboard/      # Dashboard HTML pages
├── js/             # Client-side JavaScript
└── css/            # Stylesheets
```

## License

Private — All rights reserved.
