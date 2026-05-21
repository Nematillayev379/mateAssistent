/**
 * WebApp i18n — 15 languages, data-i18n + window.t()
 */
(function (global) {
  const SUPPORTED = ['uz', 'ru', 'en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar', 'hi', 'zh', 'ja', 'ko', 'fa'];
  const RTL = ['ar', 'fa'];

  const en = {
    app_title: 'mateAssistent Dashboard',
    auth_checking: 'Verifying secure connection...',
    auth_error: 'Login error. Enter your key.',
    auth_welcome: 'Welcome to Admin Panel!',
    auth_open: 'Open Dashboard',
    auth_key_ph: 'Secret key',
    nav_overview: 'Overview',
    nav_sources: 'Sources',
    nav_studio: 'Studio',
    nav_distribution: 'Distribution',
    nav_automation: 'Automation',
    nav_analytics: 'Analytics',
    nav_wallet: 'Wallet',
    nav_wallet_analytics: 'Wallet & Analytics',
    nav_settings: 'Settings',
    nav_admin: 'Admin',
    home_stats: 'Statistics',
    home_posts: 'Total Posts',
    home_dupes: 'Duplicates',
    home_sources: 'Sources',
    home_no_sources: 'No active sources.',
    home_refs: 'Referrals',
    home_scheduled: 'Scheduled Posts',
    home_no_scheduled: 'No scheduled posts.',
    home_user_info: 'User Info',
    home_telegram_id: 'Telegram ID',
    home_username: 'Username',
    home_target: 'Target Channel',
    home_language: 'Language',
    home_role: 'Role',
    home_premium: 'Premium',
    content_rss: 'RSS Sources',
    content_src_name: 'Name',
    content_src_url: 'RSS URL',
    content_add_src: 'Add source',
    content_ai: 'AI SMM Generator',
    content_ai_ph: 'Topic...',
    content_ai_img: 'Generate image',
    content_ai_gen: 'Create post',
    content_ai_send: 'Send to channel',
    content_channels: 'Monitored Channels',
    content_ch_add: 'Add channel',
    services_hub: 'Services',
    services_media: 'Media',
    services_finance: 'Finance',
    services_tracker: 'Tracker',
    profile_settings: 'Settings',
    profile_lang: 'Language',
    profile_channel: 'Target Channel',
    profile_channel_ph: '@channel or -100...',
    profile_keywords: 'Keywords',
    profile_keywords_ph: 'word1, word2',
    profile_digest: 'Daily Digest',
    profile_digest_off: 'Off',
    profile_digest_on: 'On',
    profile_digest_time: 'Digest Time',
    profile_save: 'Save',
    premium_title: 'Premium',
    premium_active: 'Premium active',
    premium_inactive: 'Premium not active',
    premium_pay_method: 'Payment method:',
    premium_monthly: '1 Month',
    premium_monthly_desc: 'All features',
    premium_yearly: '1 Year',
    premium_yearly_desc: '10% discount',
    premium_buy: 'Buy',
    pay_stars: 'Stars',
    pay_payme: 'Payme',
    pay_click: 'Click',
    referral_title: 'Referral System',
    referral_copy: 'Copy link',
    support_title: 'Support',
    support_subject: 'Subject',
    support_message: 'Your message...',
    support_send: 'Send',
    admin_panel: 'Admin Panel',
    admin_users: 'Users',
    admin_sources: 'Sources',
    admin_broadcast: 'Broadcast',
    admin_settings: 'Settings',
    admin_status: 'System Status',
    admin_tickets: 'Tickets',
    admin_stars_price: 'Premium Stars Price',
    admin_save: 'Save',
    admin_broadcast_ph: 'Your message...',
    admin_broadcast_send: 'Send to all',
    admin_back: 'Back',
    admin_approve: 'Approve',
    admin_reject: 'Reject',
    admin_block: 'Block',
    admin_unblock: 'Unblock',
    admin_premium_30: 'Premium 30d',
    admin_change_role: 'Change role',
    admin_status_pending: 'Pending',
    admin_status_approved: 'Approved',
    admin_status_blocked: 'Blocked',
    admin_role_prompt: 'New role (user, admin, premium):',
    admin_premium_ok: 'Premium granted',
    admin_action_ok: 'Done',
    sys_uptime: 'Uptime',
    sys_redis: 'Redis',
    sys_node: 'Node',
    api_keys: 'API Keys',
    api_add: 'Add key',
    api_key_ph: 'API key',
    wallet_connection: 'Wallet connection',
    wallet_connect: 'Connect wallet',
    wallet_disconnect: 'Disconnect',
    wallet_connected: 'Connected',
    wallet_not_connected: 'Not connected',
    wallet_section_title: 'Web3 Membership Wallet',
    wallet_section_body: 'Connect a TON wallet to unlock your web3 profile layer inside the mini app.',
    analytics_section_title: 'Analytics Hub',
    finance_title: 'Financial Markets',
    trends_title: 'Google Trends',
    refresh: 'Refresh',
    search_cheapest: 'Find cheapest price',
    search_placeholder: 'Enter product name',
    search_button: 'Search',
    track_button: 'Track',
    post_language: 'Post language',
    music_search_placeholder: 'Artist or song...',
    voice_title_label: 'Title',
    voice_text_label: 'Text',
    voice_send_channel: 'Send to channel',
    voice_generate: 'Generate audio and send',
    api_keys_group: 'Added API keys',
    api_keys_empty: 'No API keys added yet.',
    common_logout: 'Logout',
    common_delete: 'Delete?',
    common_saved: 'Settings saved!',
    common_lang_changed: 'Language updated!',
    common_error: 'An error occurred',
    common_copied: 'Link copied!',
    common_ticket_sent: 'Ticket sent!',
    common_broadcast_sent: 'Broadcast queued!',
    owner_badge: 'Owner',
    admin_badge: 'Admin',
    user_default: 'User',
    yes: 'Yes',
    no: 'No',
    unknown: 'Unknown',
    not_set: 'Not configured',
    free: 'Free',
    elite: 'ELITE',
  };

  const uz = {
    ...en,
    auth_checking: 'Xavfsiz ulanish tekshirilmoqda...',
    auth_error: 'Kirishda xatolik. Kalitni yozing.',
    auth_welcome: 'Admin panelga xush kelibsiz!',
    auth_open: 'Dashboardni ochish',
    auth_key_ph: 'Maxfiy kalit',
    nav_overview: 'Umumiy ko‘rinish',
    nav_sources: 'Manbalar',
    nav_studio: 'Studiya',
    nav_distribution: 'Tarqatish',
    nav_automation: 'Avtomatlashtirish',
    nav_analytics: 'Analitika',
    nav_wallet: 'Hamyon',
    nav_wallet_analytics: 'Hamyon va Analitika',
    nav_settings: 'Sozlamalar',
    nav_admin: 'Admin',
    home_stats: 'Statistika',
    home_posts: 'Jami Postlar',
    home_dupes: 'Dublikatlar',
    home_sources: 'Manbalar',
    home_no_sources: "Faol manbalar yo'q.",
    home_refs: 'Referrallar',
    home_scheduled: 'Navbatdagi Postlar',
    home_no_scheduled: "Navbatda postlar yo'q.",
    home_user_info: "Foydalanuvchi Ma'lumotlari",
    home_telegram_id: 'Telegram ID',
    home_username: 'Username',
    home_target: 'Target Kanal',
    home_language: 'Til',
    home_role: 'Rol',
    home_premium: 'Premium',
    content_rss: 'RSS Manbalar',
    content_src_name: 'Nomi',
    content_src_url: 'RSS URL',
    content_add_src: "Manba qo'shish",
    content_ai: 'AI SMM Generator',
    content_ai_ph: 'Mavzu...',
    content_ai_img: 'Rasm generatsiya qilinsin',
    content_ai_gen: 'Post yaratish',
    content_ai_send: 'Kanalga yuborish',
    content_channels: 'Kuzatilayotgan Kanallar',
    content_ch_add: "Kanal qo'shish",
    services_hub: 'Xizmatlar',
    services_media: 'Media',
    services_finance: 'Moliya',
    services_tracker: 'Tracker',
    profile_settings: 'Sozlamalar',
    profile_lang: 'Til (Language)',
    profile_channel: 'Kanal (Target Channel)',
    profile_channel_ph: '@kanalingiz yoki -100...',
    profile_keywords: "Kalit so'zlar",
    profile_keywords_ph: "so'z1, so'z2",
    profile_digest: 'Kunlik Digest',
    profile_digest_off: "O'chirilgan",
    profile_digest_on: 'Yoqilgan',
    profile_digest_time: 'Digest Vaqti',
    profile_save: 'Saqlash',
    premium_title: 'Premium',
    premium_active: 'Premium faol',
    premium_inactive: 'Premium yoqilgan emas',
    premium_pay_method: "To'lov usuli:",
    premium_monthly: '1 Oylik',
    premium_monthly_desc: 'Barcha imkoniyatlar',
    premium_yearly: '1 Yillik',
    premium_yearly_desc: '10% chegirma',
    premium_buy: 'Sotib olish',
    pay_stars: 'Stars',
    pay_payme: 'Payme',
    pay_click: 'Click',
    referral_title: 'Referral Tizimi',
    referral_copy: 'Havolani nusxalash',
    support_title: 'Support',
    support_subject: 'Mavzu',
    support_message: 'Xabaringiz...',
    support_send: 'Yuborish',
    admin_panel: 'Admin Panel',
    admin_users: 'Foydalanuvchilar',
    admin_sources: 'Manbalar',
    admin_broadcast: 'Broadcast',
    admin_settings: 'Sozlamalar',
    admin_status: 'Tizim Statusi',
    admin_tickets: 'Ticketlar',
    admin_stars_price: 'Premium Stars Narxi',
    admin_save: 'Saqlash',
    admin_broadcast_ph: 'Xabaringiz...',
    admin_broadcast_send: 'Barchaga yuborish',
    admin_back: 'Orqaga',
    admin_approve: 'Tasdiqlash',
    admin_reject: 'Rad etish',
    admin_block: 'Bloklash',
    admin_unblock: 'Blokdan chiqarish',
    admin_premium_30: 'Premium 30 kun',
    admin_change_role: "Rolni o'zgartirish",
    admin_status_pending: 'Kutilmoqda',
    admin_status_approved: 'Tasdiqlangan',
    admin_status_blocked: 'Bloklangan',
    admin_role_prompt: 'Yangi rol (user, admin, premium):',
    admin_premium_ok: 'Premium berildi',
    admin_action_ok: 'Bajarildi',
    sys_uptime: 'Uptime',
    sys_redis: 'Redis',
    sys_node: 'Node',
    api_keys: 'API Kalitlari',
    api_add: "Kalit qo'shish",
    api_key_ph: 'API kaliti',
    wallet_connection: 'Hamyon ulanishi',
    wallet_connect: 'Hamyonni ulash',
    wallet_disconnect: 'Uzish',
    wallet_connected: 'Ulangan',
    wallet_not_connected: 'Ulanmagan',
    wallet_section_title: 'Web3 Membership Wallet',
    wallet_section_body: 'Mini app ichida web3 profilingizni faollashtirish uchun TON hamyon ulang.',
    analytics_section_title: 'Analitika markazi',
    finance_title: 'Moliyaviy bozorlar',
    trends_title: 'Google Trends',
    refresh: 'Yangilash',
    search_cheapest: 'Eng arzon narxni qidirish',
    search_placeholder: 'Mahsulot nomini yozing',
    search_button: 'Qidirish',
    track_button: 'Kuzatish',
    post_language: 'Post tili',
    music_search_placeholder: 'Artist yoki qo\'shiq...',
    voice_title_label: 'Sarlavha',
    voice_text_label: 'Matn',
    voice_send_channel: 'Kanalga yuborish',
    voice_generate: 'Audio yaratish va yuborish',
    api_keys_group: 'Qo\'shilgan API kalitlar',
    api_keys_empty: 'Hali API kalit qo\'shilmagan.',
    common_logout: 'Chiqish',
    common_delete: "O'chirilsinmi?",
    common_saved: 'Sozlamalar saqlandi!',
    common_lang_changed: "Til o'zgartirildi!",
    common_error: 'Xatolik yuz berdi',
    common_copied: 'Havola nusxalandi!',
    common_ticket_sent: 'Ticket yuborildi!',
    common_broadcast_sent: 'Broadcast yuborildi!',
    owner_badge: 'Owner',
    admin_badge: 'Admin',
    user_default: 'Foydalanuvchi',
    yes: 'Ha',
    no: "Yo'q",
    unknown: "Noma'lum",
    not_set: 'Sozlanmagan',
    free: 'Free',
    elite: 'ELITE',
  };

  const ru = {
    ...en,
    auth_checking: 'Проверка безопасного соединения...',
    auth_error: 'Ошибка входа. Введите ключ.',
    auth_welcome: 'Добро пожаловать в админ-панель!',
    auth_open: 'Открыть Dashboard',
    nav_overview: 'Обзор',
    nav_sources: 'Источники',
    nav_studio: 'Студия',
    nav_distribution: 'Дистрибуция',
    nav_automation: 'Автоматизация',
    nav_analytics: 'Аналитика',
    nav_wallet: 'Кошелек',
    nav_settings: 'Настройки',
    nav_admin: 'Админ',
    home_stats: 'Статистика',
    home_posts: 'Всего постов',
    home_dupes: 'Дубликаты',
    home_sources: 'Источники',
    home_no_sources: 'Активных источников нет.',
    home_refs: 'Рефералы',
    premium_title: 'Премиум',
    premium_buy: 'Купить',
    admin_approve: 'Одобрить',
    admin_reject: 'Отклонить',
    admin_block: 'Заблокировать',
    admin_unblock: 'Разблокировать',
    profile_save: 'Сохранить',
    common_saved: 'Настройки сохранены!',
  };

  const tr = { ...en, nav_home: 'Ana', nav_content: 'İçerik', premium_buy: 'Satın al', admin_approve: 'Onayla', admin_block: 'Engelle' };
  const de = { ...en, nav_home: 'Start', premium_buy: 'Kaufen', admin_approve: 'Genehmigen' };
  const fr = { ...en, nav_home: 'Accueil', premium_buy: 'Acheter', admin_approve: 'Approuver' };
  const es = { ...en, nav_home: 'Inicio', premium_buy: 'Comprar', admin_approve: 'Aprobar' };
  const it = { ...en, nav_home: 'Home', premium_buy: 'Acquista', admin_approve: 'Approva' };
  const pt = { ...en, nav_home: 'Início', premium_buy: 'Comprar', admin_approve: 'Aprovar' };
  const ar = { ...en, nav_home: 'الرئيسية', nav_content: 'المحتوى', premium_buy: 'شراء', admin_approve: 'موافقة', admin_block: 'حظر' };
  const hi = { ...en, nav_home: 'होम', premium_buy: 'खरीदें', admin_approve: 'स्वीकृत' };
  const zh = { ...en, nav_home: '首页', premium_buy: '购买', admin_approve: '批准' };
  const ja = { ...en, nav_home: 'ホーム', premium_buy: '購入', admin_approve: '承認' };
  const ko = { ...en, nav_home: '홈', premium_buy: '구매', admin_approve: '승인' };
  const fa = { ...en, nav_home: 'خانه', premium_buy: 'خرید', admin_approve: 'تأیید' };

  const T = { uz, ru, en, tr, de, fr, es, it, pt, ar, hi, zh, ja, ko, fa };
  let lang = localStorage.getItem('webapp_lang') || 'uz';

  function t(key, vars) {
    const dict = T[lang] || T.en || T.uz;
    let s = dict[key] ?? T.en[key] ?? T.uz[key] ?? key;
    if (vars) Object.keys(vars).forEach((k) => { s = s.replace(`{${k}}`, vars[k]); });
    return s;
  }

  function setLang(l) {
    if (!SUPPORTED.includes(l)) l = 'uz';
    lang = l;
    localStorage.setItem('webapp_lang', l);
    document.documentElement.lang = l;
    document.documentElement.dir = RTL.includes(l) ? 'rtl' : 'ltr';
    document.title = t('app_title');
    apply();
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const val = t(key);
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        if (el.getAttribute('placeholder') !== null || el.hasAttribute('data-i18n-placeholder')) {
          el.placeholder = val;
        }
      } else if (el.tagName === 'OPTION') {
        el.textContent = val;
      } else {
        const icon = el.querySelector('i[data-i18n-icon]');
        if (icon && el.classList.contains('card-title')) {
          el.childNodes.forEach((n) => { if (n.nodeType === 3) n.remove(); });
          el.appendChild(document.createTextNode(' ' + val));
        } else {
          el.textContent = val;
        }
      }
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.getAttribute('data-i18n-title'));
    });
  }

  function init(userLang) {
    if (userLang && SUPPORTED.includes(userLang)) setLang(userLang);
    else apply();
    return lang;
  }

  global.WebAppI18n = { t, setLang, apply, init, getLang: () => lang, SUPPORTED };
  global.t = t;
})(typeof window !== 'undefined' ? window : global);
