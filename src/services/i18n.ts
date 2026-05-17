import i18next from 'i18next';
import { logger } from '../utils/logger';

export const i18n = i18next;

const resources = {
  uz: { translation: { 
    welcome: '🌐 <b>Newsroom Web3 Ecosystemga xush kelibsiz!</b>\n\nSiz bu yerda o\'z Telegram kanalingizni professional yangiliklar agregatoriga aylantirishingiz mumkin.',
    help: '📚 <b>Yordam bo\'limi:</b>\n1. Manbalarni qo\'shing\n2. Kanal ID ni sozlang\n3. Botni yoqing\n\nSavollar uchun: @admin',
    settings: '⚙️ <b>Sozlamalar</b>',
    status: '📊 <b>Statistika</b>',
    premium: '🚀 <b>Premium</b>',
    daily_digest_header: 'Kunlik Yangiliklar Xulosasi',
    media_detected: 'Multimedia havolasi aniqlandi!',
    download_ask: 'Yuklab olish formatini tanlang:',
    cancel: 'Bekor qilish',
    processing: 'Ishlov berilmoqda...',
    err_invalid_url: "❌ Noto'g'ri havola",
    viral_tag: 'bilan yaratildi. Siz ham qo\'shing!',
    onboarding_welcome: 'Xush kelibsiz! Botdan foydalaningiz uchun birinchi navbatda kanalingizni sozlashingiz kerak.',
    onboarding_ask_channel: 'Iltimos, bot admin qilingan kanalingiz ID sini yoki linkini yuboring (Masalan: @kanalingiz yoki -100...):',
    onboarding_ask_lang: 'Qaysi tilda yangiliklar yuboraylik?',
    onboarding_success: 'Ajoyib! Endi bot sizga yangiliklarni yuborishni boshlashi mumkin. Boshqaruv panelini oching 👇',
    err_invalid_channel: "❌ Noto'g'ri kanal ID yoki bot u yerda admin emas!"
  }},
  ru: { translation: { 
    welcome: '🌐 <b>Добро пожаловать в Newsroom Web3 Ecosystem!</b>\n\nЗдесь вы можете превратить свой Telegram-канал в профессиональный новостной агрегатор.',
    help: '📚 <b>Раздел помощи:</b>\n1. Добавьте источники\n2. Настройте ID канала\n3. Включите бота\n\nПо вопросам: @admin',
    settings: '⚙️ <b>Настройки</b>',
    status: '📊 <b>Статистика</b>',
    premium: '🚀 <b>Премиум</b>',
    daily_digest_header: 'Ежедневный дайджест новостей',
    media_detected: 'Найдена ссылка на медиа!',
    download_ask: 'Выберите формат для скачивания:',
    cancel: 'Отмена',
    processing: 'Обработка...',
    err_invalid_url: "❌ Неверная ссылка"
  }},
  en: { translation: { 
    welcome: '🌐 <b>Welcome to Newsroom Web3 Ecosystem!</b>\n\nTurn your Telegram channel into a professional news aggregator.',
    help: '📚 <b>Help Section:</b>\n1. Add sources\n2. Setup channel ID\n3. Enable bot\n\nFor support: @admin',
    settings: '⚙️ <b>Settings</b>',
    status: '📊 <b>Statistics</b>',
    premium: '🚀 <b>Premium</b>',
    daily_digest_header: 'Daily News Digest',
    media_detected: 'Media Link Detected!',
    download_ask: 'Choose format to download:',
    cancel: 'Cancel',
    processing: 'Processing...',
    err_invalid_url: "❌ Invalid URL"
  }},
  tr: { translation: { welcome: '🌐 <b>Hoş geldiniz!</b>', help: '📚 <b>Yardım:</b>', settings: '⚙️ <b>Ayarlar</b>', status: '📊 <b>İstatistikler</b>', premium: '🚀 <b>Premium</b>', daily_digest_header: 'Günlük Haber Özeti', media_detected: 'Medya Bağlantısı Tespit Edildi!', download_ask: 'İndirme formatını seçin:', cancel: 'İptal', processing: 'İşleniyor...', err_invalid_url: "❌ Geçersiz URL" }},
  de: { translation: { welcome: '🌐 <b>Willkommen!</b>', help: '📚 <b>Hilfe:</b>', settings: '⚙️ <b>Einstellungen</b>', status: '📊 <b>Statistiken</b>', premium: '🚀 <b>Premium</b>', daily_digest_header: 'Täglicher News-Digest', media_detected: 'Medienlink erkannt!', download_ask: 'Format wählen:', cancel: 'Abbrechen', processing: 'Wird bearbeitet...', err_invalid_url: "❌ Ungültige URL" }},
  fr: { translation: { welcome: '🌐 <b>Bienvenue !</b>', help: '📚 <b>Aide :</b>', settings: '⚙️ <b>Paramètres</b>', status: '📊 <b>Stats</b>', premium: '🚀 <b>Premium</b>', daily_digest_header: 'Résumé quotidien de l\'actualité', media_detected: 'Lien média détecté !', download_ask: 'Choisissez le format :', cancel: 'Annuler', processing: 'Traitement...', err_invalid_url: "❌ URL invalide" }},
  es: { translation: { welcome: '🌐 <b>¡Bienvenido!</b>', help: '📚 <b>Ayuda:</b>', settings: '⚙️ <b>Ajustes</b>', status: '📊 <b>Estadísticas</b>', premium: '🚀 <b>Premium</b>', daily_digest_header: 'Resumen diario de noticias', media_detected: '¡Enlace de medios detectado!', download_ask: 'Elegir formato:', cancel: 'Cancelar', processing: 'Procesando...', err_invalid_url: "❌ URL no válida" }},
  it: { translation: { welcome: '🌐 <b>Benvenuti!</b>', help: '📚 <b>Aiuto:</b>', settings: '⚙️ <b>Impostazioni</b>', status: '📊 <b>Statistiche</b>', premium: '🚀 <b>Premium</b>', daily_digest_header: 'Riepilogo quotidiano delle notizie', media_detected: 'Link multimediale rilevato!', download_ask: 'Scegli il formato:', cancel: 'Annulla', processing: 'In corso...', err_invalid_url: "❌ URL non valido" }},
  pt: { translation: { welcome: '🌐 <b>Bem-vindo!</b>', help: '📚 <b>Ajuda:</b>', settings: '⚙️ <b>Configurações</b>', status: '📊 <b>Estatísticas</b>', premium: '🚀 <b>Premium</b>', daily_digest_header: 'Resumo diário de notícias', media_detected: 'Link de mídia detectado!', download_ask: 'Escolha o formato:', cancel: 'Cancelar', processing: 'Processando...', err_invalid_url: "❌ URL inválido" }},
  ar: { translation: { welcome: '🌐 <b>أهلاً بك!</b>', help: '📚 <b>مساعدة:</b>', settings: '⚙️ <b>الإعدادات</b>', status: '📊 <b>الإحصائيات</b>', premium: '🚀 <b>بريميوم</b>', daily_digest_header: 'ملخص الأخبار اليومي', media_detected: 'تم اكتشاف رابط وسائط!', download_ask: 'اختر الصيغة للتحميل:', cancel: 'إلغاء', processing: 'جاري المعالجة...', err_invalid_url: "❌ رابط غير صالح" }},
  hi: { translation: { welcome: '🌐 <b>स्वागत है!</b>', help: '📚 <b>सहायता:</b>', settings: '⚙️ <b>सेटिंग्स</b>', status: '📊 <b>आंकड़े</b>', premium: '🚀 <b>प्रीमियम</b>', daily_digest_header: 'दैनिक समाचार सारांश', media_detected: 'मीडिया लिंक मिला!', download_ask: 'डाउनलोड प्रारूप चुनें:', cancel: 'रद्द करें', processing: 'प्रक्रिया जारी है...', err_invalid_url: "❌ अमान्य URL" }},
  zh: { translation: { welcome: '🌐 <b>欢迎！</b>', help: '📚 <b>帮助：</b>', settings: '⚙️ <b>设置</b>', status: '📊 <b>统计</b>', premium: '🚀 <b>高级版</b>', daily_digest_header: '每日新闻摘要', media_detected: '检测到媒体链接！', download_ask: '选择下载格式：', cancel: '取消', processing: '处理中...', err_invalid_url: "❌ 无效的 URL" }},
  ja: { translation: { welcome: '🌐 <b>ようこそ！</b>', help: '📚 <b>ヘルプ：</b>', settings: '⚙️ <b>設定</b>', status: '📊 <b>統計</b>', premium: '🚀 <b>プレミアム</b>', daily_digest_header: '今日のニュース要約', media_detected: 'メディアリンクが検出されました！', download_ask: 'ダウンロード形式を選択してください：', cancel: 'キャンセル', processing: '処理中...', err_invalid_url: "❌ 無効な URL" }},
  ko: { translation: { welcome: '🌐 <b>환영합니다!</b>', help: '📚 <b>도움말:</b>', settings: '⚙️ <b>설정</b>', status: '📊 <b>통계</b>', premium: '🚀 <b>프리미엄</b>', daily_digest_header: '일일 뉴스 요약', media_detected: '미디어 링크가 감지되었습니다!', download_ask: '다운로드 형식을 선택하십시오:', cancel: '취소', processing: '처리 중...', err_invalid_url: "❌ 잘못된 URL" }},
  fa: { translation: { welcome: '🌐 <b>خوش آمدید!</b>', help: '📚 <b>راهنما:</b>', settings: '⚙️ <b>تنظیمات</b>', status: '📊 <b>آمار</b>', premium: '🚀 <b>پریمیوم</b>', daily_digest_header: 'خلاصه اخبار روزانه', media_detected: 'لینک چندرسانه‌ای شناسایی شد!', download_ask: 'فرمت دانلود را انتخاب کنید:', cancel: 'لغو', processing: 'در حال پردازش...', err_invalid_url: "❌ لینک نامعتبر" }}
};

/** WebApp UI strings — synced with public/js/i18n-client.js */
export const WEBAPP_LANGS = ['uz', 'ru', 'en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar', 'hi', 'zh', 'ja', 'ko', 'fa'] as const;

export async function initI18n() {
  await i18n.init({
    lng: 'uz',
    fallbackLng: 'uz',
    resources
  });
  logger.info('🌐 i18n initialized with 15 languages and extended keys');
}
