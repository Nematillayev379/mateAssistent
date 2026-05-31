# mateAssistent — Telegram RSS Bot with Web3 Dashboard

> AI-powered Telegram bot that fetches RSS news, processes with AI, and posts to channels. Features a Web3 dashboard with TON Connect, crypto payments, and premium subscriptions.

## Features

- **RSS Auto-Posting** — Fetches news from RSS feeds every 2 minutes, AI-summarizes, and posts to Telegram channels
- **Multi-Provider AI** — Groq, Gemini, OpenAI, Cerebras, OpenRouter with automatic key rotation and circuit breaker
- **Web3 Dashboard** — Dark-themed dashboard with glassmorphism design, TON Connect wallet integration
- **Crypto Payments** — Payme, Click, TON, USDT payment methods
- **Channel Monitoring** — Monitor YouTube, Instagram, Telegram channels and forward posts
- **Media Download** — YouTube, TikTok, Instagram, SoundCloud audio/video download
- **AI Studio** — Generate SMM posts, voice news, image generation
- **Workspace Management** — Multi-channel content distribution with automation rules
- **Premium System** — Subscription tiers with referral rewards (30 days free per referral)
- **i18n** — 15 languages supported (UZ, RU, EN, TR, DE, FR, ES, IT, PT, AR, HI, ZH, JA, KO, FA, KK, AZ)

## Architecture

```
src/
├── commands/        # Telegram bot command handlers
│   ├── start.ts     # /start, onboarding flow
│   ├── callbacks.ts # Inline button handlers
│   ├── admin.ts     # Admin panel
│   └── ...
├── services/        # Business logic layer
│   ├── ai.ts        # Multi-provider AI (762 lines)
│   ├── scraper.ts   # RSS fetch + article scraping
│   ├── sender.ts    # Message formatting + delivery
│   ├── redis.ts     # Redis pool with rotation
│   └── ...
├── jobs/            # Scheduled tasks & workers
│   ├── rss_cron.ts  # RSS fetch every 2 min
│   ├── digest_cron.ts # Daily news digest
│   ├── scraper_worker.ts # BullMQ worker
│   └── ...
├── handlers/        # Express API routes
│   ├── dashboard.ts # Route registrar
│   ├── auth.ts      # Auth middleware
│   └── api/         # 13 API route modules
├── repositories/    # Supabase data access (14 files)
├── config/          # Configuration + env validation
├── types/           # TypeScript interfaces
└── utils/           # Logger, crypto, yt-dlp
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 |
| Language | TypeScript (ESNext) |
| Bot Framework | node-telegram-bot-api |
| Web Server | Express 5 |
| Database | Supabase (PostgreSQL) |
| Queue | BullMQ + Redis (Upstash) |
| AI | Groq, Gemini, OpenAI, Cerebras, OpenRouter |
| Payments | Payme, Click, TON/USDT |
| Deployment | Render.com, Docker, PM2 |

## Quick Start

### Prerequisites
- Node.js 20+
- Supabase account (free tier works)
- Telegram Bot Token (from @BotFather)
- At least one AI API key (Groq recommended — free tier available)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/uzbekistan-newsroom-bot.git
cd uzbekistan-newsroom-bot

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
# Required: TELEGRAM_TOKEN, DASHBOARD_SECRET, SUPABASE_URL, SUPABASE_KEY
# Optional: GROQ_KEYS, REDIS_URL, PUBLIC_URL

# Build and start
npm run build
npm start
```

### Environment Variables

```env
# Required
TELEGRAM_TOKEN=your_bot_token
DASHBOARD_SECRET=your_secret_here
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your_supabase_key

# AI Keys (at least one provider)
GROQ_KEYS=groq_key_1,groq_key_2
GEMINI_KEYS=gemini_key_1
OPENAI_KEYS=openai_key_1

# Optional
REDIS_URL=redis://...
PUBLIC_URL=https://your-app.onrender.com
OWNER_ID=your_telegram_id
```

### Docker

```bash
docker build -t mate-assistent .
docker run -p 3000:3000 --env-file .env mate-assistent
```

## Dashboard

The Web3 dashboard is accessible via Telegram WebApp or browser:

- **Overview** — Stats, recent activity, bot status
- **Sources** — Add/remove RSS feeds
- **Studio** — AI post generation, voice news, music download
- **Distribution** — Channel management, workspace setup
- **Automation** — Scheduling, auto-posting rules
- **Analytics** — Post statistics, finance data
- **Wallet** — Premium subscription, TON Connect
- **Settings** — Language, target channel, intervals

## API Endpoints

All endpoints require `x-bot-token` and `x-user-id` headers.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard-info` | GET | User info + stats |
| `/api/sources/:userId` | GET/POST | RSS sources |
| `/api/settings/:userId` | GET/POST | User settings |
| `/api/ai/smm` | POST | Generate AI post |
| `/api/posts/publish` | POST | Publish to channel |
| `/api/premium/buy` | POST | Purchase subscription |
| `/api/admin/users` | GET | Admin: list users |

## Testing

```bash
# Run all tests (128 tests)
npm test

# Run specific test suite
npx jest tests/ai.test.ts

# Type checking
npm run typecheck
```

## Deployment

### Render.com (Recommended)

1. Fork this repository
2. Create a new Web Service on Render
3. Connect your GitHub repo
4. Set environment variables in Render dashboard
5. Deploy automatically on push

### PM2 (Self-hosted)

```bash
npm run build
npm run start:cluster
```

## Rate Limiting

- **API**: 60 requests/minute per IP
- **Bot Commands**: 5 commands/second, 15 commands/minute per user
- **Bot Messages**: 30 messages/minute per user

## License

MIT

## Support

- **Issues**: [GitHub Issues](https://github.com/your-username/uzbekistan-newsroom-bot/issues)
- **Contact**: @your_username on Telegram
