# Database Migration Instructions

## MUHIM: Supabase da quyidagi SQL kodini ishga tushiring

1. Supabase dashboardiga o'ting
2. Projectingizni tanlang
3. "SQL Editor" bo'limiga o'ting
4. Yangi query yarating
5. `supabase_migration.sql` faylidan barcha kodni nusqa olib qo'ying
6. "Run" tugmasini bosing

## Nima uchun bu kerak?

Botda quyidagi xatolar bor edi:
- `users.created_at` ustuni yo'q
- `monitored_channels` jadvali yo'q
- `bot_settings` jadvali yo'q  
- `user_api_keys` jadvali yo'q
- `increment_stat` RPC funksiyasi yo'q
- `get_setting` va `set_setting` RPC funksiyalari yo'q

Migration fayli bularning hammasini to'g'irlaydi.

## Keyin qilish kerak:

1. Botni qayta ishga tushuring: `npm run dev`
2. Xatolarning yo'qolganini tekshiring
