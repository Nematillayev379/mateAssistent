# Bot Full Prompt for AI Dashboard Generator

## Overview
Telegram RSS-bot with Web3 dashboard. Users add RSS sources → bot fetches news → AI processes → posts to Telegram channels. Supabase backend, Express server, Render deploy.

## Server Config
- `PUBLIC_URL` = `https://mateassistant.onrender.com`
- Auth: `x-bot-token` header + `x-user-id` header (passed as URL params `?token=XXX&user=YYY`)
- Each HTML page must include:
  ```html
  <script src="/js/dashboard-api.js"></script>
  <link href="/css/dashboard.css" rel="stylesheet"/>
  ```
- Pages are served directly: `/dashboard/overview.html` → `GET /dashboard/overview`
- `body` tag needs `data-page="{page_name}"` attribute

## Design System (Dark Theme)
CSS Variables (`/css/dashboard.css`):
- Background: `#0A0A0B`
- Surface: `#14121c`, cards: `#111113`, borders: `#1E1E22`
- Primary: `#c9beff`, Primary Container: `#6c47ff`
- Secondary: `#41eec2`, Secondary Container: `#00d1a7`
- Error: `#ffb4ab`
- Text: `#e6e0ef` (on-surface), `#c9c3d9` (on-surface-variant)
- Font: 'Geist' sans-serif, 'JetBrains Mono' monospace
- Border radius: `xl` = `12px`, `lg` = `8px`
- All buttons: `rounded-lg`, inputs: `rounded-lg border border-outline-variant bg-surface-container-lowest`
- Existing CSS classes: `.card` (bg #111113 border #1E1E22), `.badge`, `.pulse-green`, `.toast`, `.custom-scrollbar`

## Mobile + Desktop Structure
Each page has TWO parallel sections:
1. **Desktop** (`class="hidden lg:block ml-64 pt-14 p-container-padding"`) — sidebar on left
2. **Mobile** (`class="lg:hidden flex-1 mt-14 p-container-padding pb-[72px]"`) — bottom nav

Sidebar: `hidden lg:flex w-64 fixed left-0 top-0 h-full bg-surface-container-lowest border-r border-outline-variant flex-col`
Bottom Nav: `fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-[56px] bg-surface border-t border-outline-variant lg:hidden`

## API Endpoints (all require `x-bot-token` header)

### Auth & User
- `GET /api/dashboard-info` — user info + stats + scheduled + referrals + workspaces + tickets
  Response: `{ user: { telegram_id, username, first_name, role, is_premium, is_approved, is_active, target_channel, language, premium_until, referral_code, api_key_count }, stats: { total_posts, total_duplicates }, scheduled: [...], referrals: { total, active, needed }, workspaces: [...] }`
- `POST /api/auth/web-register` — `{ email, password, token? }` → `{ token, userId }`
- `POST /api/auth/web-login` — `{ email, password }` → `{ token, userId }`

### Sources (RSS)
- `GET /api/sources/:userId` — list of user's RSS sources
  Response: `[{ id, name, url, lang, is_active, created_at }]`
- `POST /api/sources/:userId` — add source: `{ name, url, lang? }`
- `DELETE /api/sources/:userId/:id` — delete source
- `GET /api/tracker/search?q=...` — search tracked products
- `GET /api/tracker/cheapest?q=...` — cheapest price search

### Settings
- `GET /api/settings/:userId` — get user settings
- `POST /api/settings/:userId` — update: `{ language?, target_channel?, keywords?, interval_minutes?, daily_digest?, digest_time? }`
- `GET /api/settings/:userId/extended` — get extended settings
- `POST /api/settings/:userId/extended` — save extended: `{ language, target_channel, keywords, interval_minutes, daily_digest, digest_time }`
- `POST /api/settings/:userId/toggle` — toggle: `{ setting, value }`

### Content
- `POST /api/posts/publish` — publish post: `{ text, imageUrl?, imageBase64?, channels? }`
- `POST /api/posts/draft` — save draft: `{ title?, body, image_url? }`
- `GET /api/posts/drafts/:userId` — get drafts
- `GET /api/scheduled/:userId` — scheduled posts list
- `POST /api/scheduled/:userId` — create scheduled: `{ type, content, scheduled_at }`
- `DELETE /api/scheduled/:userId/:id` — cancel scheduled
- `GET /api/rules/:userId` — automation rules
- `POST /api/rules/:userId` — add rule
- `DELETE /api/rules/:userId/:id` — delete rule

### AI Studio
- `POST /api/ai/smm` — generate AI post: `{ prompt, language, withImage }` → `{ text, imageBase64?, imageUrl? }`
- `POST /api/ai/post-to-channel` — send AI post: `{ text, prompt?, imageUrl?, imageBase64? }`
- `POST /api/ai/voice-news` — voice news: `{ title, text, sendToChannel }` → `{ success }`
- `GET /api/music/search?q=...` — search YouTube music → `[{ videoId, title, url }]`
- `GET /api/music/download/:id?web=1` — download music (returns blob)
- `GET /api/music/download/:id?send=1` — download + send to channel → `{ success, message }`
- `POST /api/media/download` — video/audio download: `{ url, type: 'video'|'audio', delivery: 'web' }` (returns blob)

### Channels (Distribution)
- `GET /api/channels/:userId` — list monitored channels → `[{ id, channel_username, channel_id, is_active, forward_mode, use_ai }]`
- `POST /api/channels/:userId` — add channel: `{ channel_id, platform?, forward_mode?, use_ai? }`
- `DELETE /api/channels/:userId/:id` — remove channel
- `GET /api/workspaces/:userId` — list workspaces
- `POST /api/workspaces/:userId` — create workspace: `{ name }`
- `POST /api/workspaces/:userId/:id/channel` — add channel to workspace

### Wallet & Premium
- `GET /api/premium-info` → `{ is_premium, plan, premium_until }`
- `GET /api/payments/methods` → `{ stars: bool, usdt: bool, ton: bool }`
- `POST /api/premium/buy` — buy: `{ period: 'monthly'|'yearly', method: 'stars'|'usdt'|'ton' }` → `{ success, url? }`
- `POST /api/premium/wallet-claim` — TON wallet claim: `{ walletAddress }` → `{ success, days }`
- `GET /api/affiliate` — referral link + stats

### Finance & Trends
- `GET /api/finance/prices` → `{ btc: "12345", usd: "12800" }`
- `GET /api/trends/uz` — Google Trends for Uzbekistan

### Tickets
- `GET /api/tickets/:userId` — user's tickets
- `POST /api/tickets/:userId` — create ticket: `{ subject, message }`
- `GET /api/tickets/all` — admin: all tickets

### Admin
- `GET /api/admin/users` — list users: `[{ telegram_id, username, first_name, role, is_active, is_approved, is_premium, premium_until, target_channel, referral_code, ... }]`
- `GET /api/admin/settings` — system settings
- `POST /api/admin/settings` — save: `{ premium_stars_price, premium_monthly_price, premium_yearly_price, require_approval }`
- `GET /api/admin/prices` → `{ monthly, yearly, stars }`
- `POST /api/admin/users/:id/approve` — approve user
- `POST /api/admin/users/:id/reject` — reject
- `POST /api/admin/users/:id/block` — block
- `POST /api/admin/users/:id/unblock` — unblock
- `POST /api/admin/users/:id/premium` — grant/revoke: `{ days }` (0 = revoke)
- `POST /api/admin/users/:id/role` — change role: `{ role }`
- `GET /api/admin/system` → `{ uptime, version, user_count, source_count, post_count, memory_usage, redis, nodeVersion }`
- `GET /api/admin/sources` — all sources
- `POST /api/admin/broadcast` — send to all: `{ message }`

## JS Helpers (available in dashboard-api.js)
```javascript
window.apiFetch(resource, options)  // auto-adds x-bot-token + x-user-id headers
window.showToast(msg, type)         // 'info'|'success'|'error'
window.__token                      // bot token
window.__userId                     // user telegram_id
```

## Keyboard Support
- Enter key on `#music-q` → searchMusic()
- Enter key on `#dl-url` → downloadMedia('video')

## Page List & Required Functionality

### Overview (`data-page="overview"`)
- Show stats: total_posts, total_duplicates, active sources count
- User name, role, target channel
- Recent activity (from dashboard-info)
- Bot status

### Sources (`data-page="sources"`)
- `#sources-list` — dynamic list of RSS sources
- `#src-name` + `#src-url` + saveSource() button — add new source
- deleteSource(id) — remove source
- loadSources() — refresh list

### Studio (`data-page="studio"`)
- `#ai-prompt` textarea + `#btn-ai` button → generateAIPost()
- `#ai-image` checkbox — generate with image
- `#ai-result` + `#ai-res-text` + `#ai-res-img` — result display
- copyAIPost() + sendAIPost() — result actions
- `#voice-title` + `#voice-text` + `#voice-to-channel` + `#voice-status` → generateVoiceNews()
- `#music-q` + `#music-list` → searchMusic() → results with downloadMusic(id,title,btn) + sendMusic(id,title,btn)
- `#dl-url` + `#btn-dl-video` + `#btn-dl-audio` → downloadMedia(type, btn)

### Settings (`data-page="settings"`)
- `#set-lang` — language select
- `#set-channel` — target channel input
- `#set-keywords` — keywords filter
- `#set-interval` — posting interval (minutes)
- `#set-digest` — daily digest on/off
- `#set-digest-time` — digest time
- saveSettings() — save all settings
- removeChannel() — clear target channel

### Distribution (`data-page="distribution"`)
- `#set-channel` — target channel input
- `#new-channel` — add extra channel input
- `#channels-list` — channel list container
- addChannel() + removeChannel(id) — manage channels
- Workspace management (if workspaces exist)

### Analytics (`data-page="analytics"`)
- Stats cards: total_posts, total_duplicates, active sources
- Finance: loadFinance() → BTC price + USD rate
- Trends

### Wallet (`data-page="wallet"`)
- `#payment-methods` — payment method buttons (Stars/USDT/TON)
- `#wallet-status`, `#wallet-plan`, `#wallet-expiry` — premium status
- buyPremium('monthly') / buyPremium('yearly') — purchase

### Automation (`data-page="automation"`)
- Same form fields as Settings (set-lang, set-channel, set-keywords, set-interval, set-digest, set-digest-time)
- saveSettings() + removeChannel()

### Admin: Overview (`data-page="admin-overview"`)
- Admin stats: user count, source count, post count
- `.admin-stat-users`, `.admin-stat-sources`, `.admin-stat-posts`

### Admin: Users (`data-page="admin-users"`)
- `#admin-users-list` — user list generated by loadAdminUsers()
- adminUserAction(id, type) — approve/block/premium/revoke

### Admin: Broadcast (`data-page="admin-broadcast"`)
- `#broadcast-msg` textarea + sendBroadcast() button

### Admin: System Config (`data-page="admin-system-config"`)
- `#premium-stars` + `#premium-monthly` + `#premium-yearly` + `#require-approval`
- saveAdminSettings()

### Admin: System Status (`data-page="admin-system"`)
- `.sys-uptime`, `.sys-memory`, `.sys-version`, `.sys-node`, `.sys-redis`
- loadSystemStatus()

## Example: How to Call API (Vanilla JS)
```javascript
apiFetch('/api/dashboard-info')
  .then(r => r.json())
  .then(data => {
    document.querySelector('.stat-total-posts').textContent = data.stats.total_posts;
    document.querySelector('.sidebar-user-name').textContent = data.user.first_name;
  });
```

## Example: data-page="wallet" Premium Buy
```html
<button onclick="buyPremium('monthly')" class="bg-primary text-on-primary px-6 py-3 rounded-lg font-bold">
  Subscribe Monthly
</button>
```

## Notes
- All pages: Desktop sidebar + Mobile bottom nav
- `class="hidden lg:block"` for desktop, `class="lg:hidden"` for mobile
- Use `apiFetch()` not raw `fetch()` (auto-auth)
- Toast messages with `showToast('Message', 'success'|'error'|'info')`
- Existing buttons use `onclick="functionName()"` pattern
