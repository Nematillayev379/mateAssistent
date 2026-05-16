# Botni To'liq Tuzatish Bo'yicha Ko'rsatmalar

## 🚨 MUHIM: Supabase Migratsiyasi

Bot ishlashi uchun avval Supabase da to'liq migratsiyani ishga tushiring:

1. Supabase dashboard → SQL Editor
2. `COMPLETE_MIGRATION.sql` faylidan barcha kodni nusqa oling
3. "Run" tugmasini bosing

Bu quyidagilarni yaratadi:
- ✅ `users` jadvali (barcha ustunlar bilan)
- ✅ `sources` jadvali (RSS manbalari uchun)
- ✅ `seen` jadvali (dublikatlar uchun)
- ✅ `stats` jadvali (statistika uchun)
- ✅ Barcha RPC funksiyalari

## 🤖 Avtomatik Yangiliklar Yuborish

Muammo: Bot RSS dan yangiliklar o'qimayapti va kanalga yubormayapti.

Yechim:
1. Migratsiyadan so'ng botni qayta ishga tushiring: `npm run dev`
2. Web3 dashboard orqali RSS manba qo'shing:
   - Kanal ID sini kiriting
   - RSS URL sini kiriting
   - Intervalni tanlang (masalan, 15 daqiqa)
3. Bot har minutni tekshiradi va vaqti kelganda avtomatik yuboradi

## 📝 AI Post Generator Media Muammosi

Muammo: Faqat matn yuborayapti, rasm yuklamayapti.

Yechim:
API yangilandi - endi `withImage` parametri mavjud:

```javascript
// Faqat matn
POST /api/ai/smm
{ "prompt": "Yangi mahsulot chiqardi" }

// Matn + rasm
POST /api/ai/smm  
{ "prompt": "Yangi mahsulot chiqardi", "withImage": true }
```

## 🔍 Tekshirish Qadamlari

1. **Database status**: `node debug_database.js`
2. **Bot logs**: `logs/application-2026-05-10.log`
3. **Dashboard**: `http://localhost:3000`

## ⚡ Tezkor Tuzatish

Agar bot hali ham ishlamasa:

1. Bot to'xtating: `Ctrl+C`
2. Worker lock ni tozalash: `node debug_database.js`
3. Botni qayta ishga tushiring: `npm run dev`

## 📊 Ishlash Prinsipi

Bot quyidagicha ishlaydi:
1. Har minut `CONFIG.WATCHER_CRON` bo'yicha ishga tushadi
2. Faol foydalanuvchilarni tekshiradi
3. Ularning RSS manbalaridan yangiliklar oladi
4. AI orqali dublikat va moderation tekshiruvidan o'tkazadi
5. Kanalga yuboradi

Muvaffaqiyatli migratsiyadan so'ng barcha muammolar hal bo'ladi!
