# mateAssistent — Grant & Akselerator Hujjatlari

## Loyiha Haqida Qisqacha

**Nomi:** mateAssistent — AI Telegram RSS Bot
**Versiya:** 2.0.0
**Teknologiya:** TypeScript, Node.js, Express, Supabase, BullMQ, Redis
**Deploy:** Render.com (Docker + PM2 support)
**Testlar:** 128 ta unit test (Jest)
**Tillar:** 16 ta (O'zbek, Rus, Ingliz, Turk, Qozoq, Qirg'iz, Ozarbayjon, Arab, Xitoy, Yapon, Koreya, Farsi, Nemis, Frantsuz, Ispan, Portugaliya, Hindi)

---

## 1. IT Park Uzbekistan — Startup Grant

**Maqsad:** IT sohasida startup loyihalarni qo'llab-quvvatlash
**Grant miqdori:** 50,000,000 - 500,000,000 UZS
**Muddat:** 6-12 oy
**Kriteriyalar:**
- ✅ O'zbekistonda ro'yxatdan o'tgan
- ✅ Tech startup (AI, Web3)
- ✅ Tijoratlashtirish potensiali
- ✅ Jamoa (3+ a'zo)

**Hujjatlar:**
1. Business Plan (inglizcha + o'zbekcha)
2. Pitch Deck (10-15 slayd)
3. Texnik ariza (architecture, tech stack)
4. Jamoa a'zolari CV/lari
5. Moliyaviy prognoz (3 yil)

**Murojaat:** https://itpark.uz/grants

---

## 2. UNDP Accelerate — SDG Startup Lab

**Maqsad:** Barqaror rivojlanish maqsadlariga xizmat qiluvchi startuplar
**Grant miqdori:** $10,000 - $50,000
**Muddat:** 3-6 oy (akselerator)
**Kriteriyalar:**
- ✅ SDG ga hissa qo'shadi (7, 8, 9, 11, 12, 17)
- ✅ Ijtimoiy ta'sir
- ✅ Innovatsion yechim
- ✅ Masshtablanish imkoniyati

**Hujjatlar:**
1. Application Form (online)
2. Impact Assessment
3. Business Model Canvas
4. Sustainability Plan
5. Video Pitch (3 daqiqa)

**Murojaat:** https://accelerate.undp.org

---

## 3. Silkroad Innovations — Tech Accelerator

**Maqsad:** Markaziy Osiyo tech startuplarini global bozorga chiqarish
**Grant miqdori:** $25,000 - $100,000 (investitsiya)
**Muddat:** 12 oy (akselerator + mentorlik)
**Kriteriyalar:**
- ✅ Tech startup (SaaS, AI, Fintech)
- ✅ Revenue yoki traction bor
- ✅ Global bozorga chiqish niyati
- ✅ Founders tajribali

**Hujjatlar:**
1. Pitch Deck
2. Financial Projections
3. Traction Metrics (MAU, Revenue, Growth)
4. Competitive Analysis
5. Team Background

**Murojaat:** https://silkroadinnovations.com

---

## 4. Global Innovation Fund — Tech for Good

**Maqsad:** Texnologiya orqali ijtimoiy muammolarni hal qilish
**Grant miqdori:** $50,000 - $500,000
**Muddat:** 12-24 oy
**Kriteriyalar:**
- ✅ Ijtimoiy ta'sir (health, education, governance)
- ✅ Innovatsion texnologiya
- ✅ Proof of concept
- ✅ Sustainability plan

**Hujjatlar:**
1. Concept Note (2 sahifa)
2. Full Proposal (20 sahifa)
3. Budget Breakdown
4. Monitoring & Evaluation Plan
5. Team CVs

**Murojaat:** https://globalinnovationfund.org

---

## 5. Google for Startups — Cloud Program

**Maqsad:** Startuplarga Google Cloud credits va mentorlik
**Grant miqdori:** $100,000 - $200,000 (Cloud credits)
**Muddat:** 12 oy
**Kriteriyalar:**
- ✅ Tech startup
- ✅ VC funded yoki revenue bor
- ✅ Google Cloud ishlatish
- ✅ Growth stage

**Hujjatlar:**
1. Application Form (online)
2. Product Demo
3. Technical Architecture
4. Growth Metrics

**Murojaat:** https://startup.withgoogle.com

---

## 6. USAID Innovation Hub — Digital Solutions

**Maqsad:** Rivojlanayotgan mamlakatlarda raqamli yechimlar
**Grant miqdori:** $25,000 - $200,000
**Muddat:** 6-18 oy
**Kriteriyalar:**
- ✅ Digital inclusion
- ✅ Local language support
- ✅ Scalable solution
- ✅ Community impact

**Hujjatlar:**
1. Application Form
2. Theory of Change
3. Impact Measurement Plan
4. Sustainability Strategy

**Murojaat:** https://usaidinnovationhub.org

---

## Pitch Deck Tuzilmasi (10-15 slayd)

1. **Cover** — Loyiha nomi, tagline, logo
2. **Problem** — Qanday muammo? Kimlar uchun?
3. **Solution** — Bizning yechimimiz
4. **Market** — Bozor hajmi (TAM/SAM/SOM)
5. **Product** — Demo, screenshots
6. **Traction** — Foydalanuvchilar, revenue, growth
7. **Business Model** — Qanday pul ishlaymiz?
8. **Competition** — Raqobatchan ustunlik
9. **Team** — Jamoa a'zolari
10. **Financials** — 3 yillik prognoz
11. **Ask** — Qancha kerak, nima uchun
12. **Vision** — Kelajak rejalari

---

## Texnik Ariza (Architecture Overview)

```
┌─────────────────────────────────────────────────────────┐
│                    mateAssistent                         │
├─────────────────────────────────────────────────────────┤
│  Frontend: HTML/CSS/JS, Tailwind CSS, Chart.js          │
│  Backend: Node.js 20, TypeScript, Express 5              │
│  Database: Supabase (PostgreSQL)                         │
│  Queue: BullMQ + Redis (Upstash)                        │
│  AI: Groq, Gemini, OpenAI, Cerebras, OpenRouter         │
│  Bot: node-telegram-bot-api                             │
│  Deploy: Render.com, Docker, PM2                        │
│  Payments: Payme, Click, TON/USDT                       │
│  Monitoring: Sentry, Custom Health Monitor              │
└─────────────────────────────────────────────────────────┘
```

---

## Moliyaviy Prognoz (3 Yil)

| Yil | Foydalanuvchilar | Revenue (UZS) | Xarajat (UZS) |
|-----|------------------|---------------|---------------|
| 1   | 1,000            | 50,000,000    | 30,000,000    |
| 2   | 5,000            | 250,000,000   | 120,000,000   |
| 3   | 20,000           | 1,000,000,000 | 400,000,000   |

---

## Keyingi Qadamlar

1. **Hozir:** Pitch Deck tayyorlash (1 hafta)
2. **1-2 hafta:** Business Plan yozish (2 hafta)
3. **3-4 hafta:** Application form to'ldirish
4. **1-2 oy:** Intervyular va taqdimotlar
5. **3 oy:** Grant olish va ish boshlash
