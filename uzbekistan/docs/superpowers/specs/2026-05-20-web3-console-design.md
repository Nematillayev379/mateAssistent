# 2026-05-20 Web3 Console and Bot Onboarding Design

## Goal
Transform the current Telegram bot and WebApp into a cohesive Web3-style creator console with a guided onboarding flow, unified language behavior, stronger publishing controls, and a cleaner information architecture.

## Product Scope
This design covers three connected surfaces:
- Telegram bot onboarding and daily command UX
- WebApp / dashboard redesign and navigation restructure
- Shared publishing engine behavior for language, channel routing, scheduling, interval control, and duplicate protection

## First Release Outcome
The first release should feel like one product instead of separate tabs and bot fragments. A user should be able to:
1. Start the bot
2. Understand what the bot can do
3. Choose a language once
4. Connect a Telegram channel
5. Add RSS sources
6. Set posting interval
7. Open a premium Web3-style dashboard
8. Use AI post generation, media tools, and automation from predictable places

## Experience Principles
- One source of truth for user language
- One guided path from start to publishing
- Fewer scattered tabs, stronger feature grouping
- Dark, premium, Web3-native visual language
- Fast first load and lazy loading for heavy views
- Safe automation with visible state and clear failures

## Architecture Direction
Use the existing monolith and existing APIs, but reorganize the client and bot UX around clearer product domains rather than feature dumping.

### Domain Groups
- Overview
- Sources
- Studio
- Distribution
- Automation
- Analytics
- Wallet
- Settings
- Admin

This keeps implementation realistic while producing a product-level redesign.

## Telegram Bot Design

### Start Flow
When the user presses `/start`, the bot should:
1. Introduce the product and describe major capabilities
2. Ask for language selection
3. Persist that language as the default for both bot UI and generated post language
4. Ask the user to add the bot as admin in the target channel
5. Ask for target channel username or ID
6. Ask for RSS source link
7. Ask for posting interval
8. Present the main menu

### Bot Capabilities Message
The intro should briefly explain that the bot can:
- Pull and repost RSS content
- Generate AI posts and AI images
- Download and route music/video
- Schedule and automate channel publishing
- Manage dashboard and analytics

### Language Behavior
A single selected language should drive:
- Bot menus
- Bot replies
- Onboarding messages
- Settings labels
- AI post generation default language
- WebApp default language on next open

The language switch must immediately affect subsequent bot interactions and should refresh the main menu after change.

### Main Menu Structure
After onboarding, the main menu should expose:
- Dashboard
- Sources
- AI Studio
- Channel
- Automation
- Analytics
- Settings
- Help

## WebApp / Web3 Console Design

### Information Architecture
The redesigned dashboard should use these primary sections:

#### Overview
- Account summary
- Posting health
- Next scheduled actions
- Source count
- Duplicate prevention status
- Quick actions

#### Sources
- RSS and tracked source management
- Source health
- Last fetch state
- Duplicate controls
- Per-source status and pause/resume

#### Studio
- AI post generator
- AI image generation
- Draft preview
- Post language selection override
- Send now / save draft

#### Distribution
- Target channel management
- Channel validation
- Post format preview
- Media send destination control
- Bot admin verification state

#### Automation
- Posting interval
- Scheduler configuration
- Retry state
- Queue visibility
- Cooldown behavior

#### Analytics
- Total posts
- Duplicate rejects
- Source performance
- Publish success/failure rate
- Recent activity log

#### Wallet
- Web3 identity shell
- Wallet connect placeholder or first integration surface
- Membership / premium state
- Future billing and rewards home

#### Settings
- Bot language
- Post default language
- Notification preferences
- Safety and moderation preferences

#### Admin
- User moderation
- Source moderation
- Broadcast tools
- Support / tickets
- Platform settings

### Navigation Model
Replace the scattered current tabs with a persistent bottom or side navigation backed by the domain groups above. Secondary actions should live inside each section, not as top-level tabs.

### Visual Direction
- Premium black base with restrained neon accents
- Subtle glass and depth, not noisy gradients
- Dense but readable creator-tool layout
- High-contrast controls
- Strong metric cards and pipeline views
- Web3 feel without gimmick overload

## Publishing Behavior

### Unified Post Structure
Channel posts should follow a consistent structure:
1. Image or media first when available
2. Title
3. Main body content
4. Source attribution as a clickable link
5. Product attribution: created in mateAssistent bot

### Interval Rules
Posting interval must apply to actual send cadence, not only feed scanning. The system should prevent bursts by reserving a user send slot for the configured interval.

### Duplicate Protection
Duplicate checks should combine:
- Normalized URL comparison
- Normalized title comparison
- Similar-title matching
- Recent lock reservation
- Queue-level suppression

## Performance Direction
- Lazy load heavy dashboard sections
- Reduce parallel startup requests
- Prefer incremental rendering over one huge blocking page init
- Keep cached user/session data available between tab switches

## Error Handling
- Channel misconfiguration should block publishing and show a targeted fix path
- Language save failures should fall back safely and notify user
- Duplicate blocks should be visible but not spammy
- Repeated send failures should be rate-limited in user notifications

## Testing Scope
- Bot onboarding happy path
- Language change updates bot menu immediately
- RSS to channel flow with interval respected
- Duplicate source flood suppression
- AI Studio create and send flow
- Dashboard first-load and section navigation smoke checks

## Implementation Strategy
Implement in this order:
1. Bot onboarding and language unification
2. Dashboard information architecture restructure
3. Web3 visual redesign
4. Distribution and automation controls cleanup
5. Analytics and wallet surfaces
6. Final performance pass and UX polish

## Non-Goals for First Release
- Full token economy
- Onchain rewards logic
- Multi-wallet advanced transaction flows
- Complex community quest mechanics

Those should remain future extensions after the core creator console is stable.
