const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// 1. Services subpages buttons
html = html.replace(
  /<div style=\"display: grid; grid-template-columns: 1fr 1fr; gap: 12px;\">[\s\S]*?<\/div>/,
  `<div style=\"display: grid; grid-template-columns: 1fr 1fr; gap: 12px;\">
                        <button class=\"btn btn-ghost\" onclick=\"showSubPage('media')\"><i class=\"fas fa-play-circle\"></i> Media</button>
                        <button class=\"btn btn-ghost\" onclick=\"showSubPage('finance')\"><i class=\"fas fa-chart-bar\"></i> Moliya</button>
                        <button class=\"btn btn-ghost\" onclick=\"showSubPage('tracker')\"><i class=\"fas fa-bell\"></i> Tracker</button>
                        <button class=\"btn btn-ghost\" onclick=\"showSubPage('settings')\"><i class=\"fas fa-cog\"></i> Sozlamalar</button>
                        <button class=\"btn btn-ghost\" style=\"color: var(--gold); border-color: var(--gold);\" onclick=\"showSubPage('premium')\"><i class=\"fas fa-crown\"></i> Premium</button>
                    </div>`
);

// 2. Add Settings & Premium subpages inside page-services (before page-profile)
const settingsAndPremiumHTML = `                <!-- Settings Sub-page -->
                <div id=\"subpage-settings\" style=\"display: none;\">
                    <div class=\"card\">
                        <div class=\"card-title\"><i class=\"fas fa-cog\"></i> Sozlamalar</div>
                        <div class=\"input-group\">
                            <label style=\"font-size: 0.75rem; color: var(--secondary); margin-bottom: 5px; display: block;\">Til (Language)</label>
                            <select id=\"set-lang\">
                                <option value=\"uz\">O'zbek tili</option>
                                <option value=\"ru\">Русский язык</option>
                                <option value=\"en\">English</option>
                                <option value=\"tr\">Türkçe</option>
                                <option value="de">Deutsch</option>
                                <option value="fr">Français</option>
                                <option value="es">Español</option>
                                <option value="it">Italiano</option>
                                <option value="pt">Português</option>
                                <option value="ar">العربية</option>
                                <option value="hi">हिन्दी</option>
                                <option value="zh">中文</option>
                                <option value="ja">日本語</option>
                                <option value="ko">한국어</option>
                                <option value="fa">فارسی</option>
                            </select>
                        </div>
                        <div class=\"input-group\">
                            <label style=\"font-size: 0.75rem; color: var(--secondary); margin-bottom: 5px; display: block;\">Kanal (Target Channel)</label>
                            <input type=\"text\" id=\"set-channel\" placeholder=\"@kanalingiz yoki -100...\">
                        </div>
                        <div class=\"input-group\">
                            <label style=\"font-size: 0.75rem; color: var(--secondary); margin-bottom: 5px; display: block;\">Kalit so'zlar (Keywords)</label>
                            <input type=\"text\" id=\"set-keywords\" placeholder=\"so'z1, so'z2, so'z3\">
                        </div>
                        <div class=\"input-group\">
                            <label style=\"font-size: 0.75rem; color: var(--secondary); margin-bottom: 5px; display: block;\">Kunlik Digest</label>
                            <select id=\"set-digest\">
                                <option value=\"false\">O'chirilgan</option>
                                <option value=\"true\">Yoqilgan</option>
                            </select>
                        </div>
                        <div class=\"input-group\">
                            <label style=\"font-size: 0.75rem; color: var(--secondary); margin-bottom: 5px; display: block;\">Digest Vaqti</label>
                            <input type=\"time\" id=\"set-digest-time\" value=\"20:00\">
                        </div>
                        <button class=\"btn btn-primary\" onclick=\"saveSettings()\">Saqlash</button>
                    </div>
                    <button class=\"btn btn-ghost\" onclick=\"showPage('services')\">Orqaga</button>
                </div>

                <!-- Premium Sub-page -->
                <div id=\"subpage-premium\" style=\"display: none;\">
                    <div class=\"card premium-intro\" style=\"border: 1px solid var(--gold); background: rgba(245, 158, 11, 0.05);\">
                        <div class=\"card-title\" style=\"color: var(--gold);\"><i class=\"fas fa-crown\"></i> Premium ELITE</div>
                        <div id=\"premium-info\" style=\"font-size: 0.85rem; color: var(--secondary); margin-bottom: 15px; line-height: 1.6;\">Yuklanmoqda...</div>
                    </div>
                    <div class=\"card\">
                        <div class=\"card-title\"><i class=\"fas fa-tag\"></i> Reja tanlang</div>
                        <p data-i18n=\"premium_pay_method\" style=\"font-size:0.8rem;color:var(--secondary);margin-bottom:8px;\">To'lov usuli:</p>
                        <div id=\"pay-methods-container\" style=\"display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;\"></div>
                        <div id=\"premium-plans\" style=\"margin-top: 8px;\">
                            <div class=\"item-row\" style=\"margin-bottom: 15px;\">
                                <div>
                                    <h4>1 Oylik</h4>
                                    <p style=\"color: var(--gold); font-weight: bold;\" id=\"price-monthly\">--- UZS</p>
                                    <p style=\"color: var(--secondary);\">Barcha imkoniyatlar</p>
                                </div>
                                <button class=\"btn btn-primary\" style=\"width: auto; padding: 8px 16px; background: var(--gold); color: black;\" onclick=\"buyPremium('monthly')\">Sotib olish</button>
                            </div>
                            <div class=\"item-row\">
                                <div>
                                    <h4>1 Yillik</h4>
                                    <p style=\"color: var(--gold); font-weight: bold;\" id=\"price-yearly\">--- UZS</p>
                                    <p style=\"color: var(--secondary);\">10% chegirma</p>
                                </div>
                                <button class=\"btn btn-primary\" style=\"width: auto; padding: 8px 16px; background: var(--gold); color: black;\" onclick=\"buyPremium('yearly')\">Sotib olish</button>
                            </div>
                        </div>
                    </div>
                    <button class=\"btn btn-ghost\" onclick=\"showPage('services')\">Orqaga</button>
                </div>
            </section>
            <!-- 5. Profile`;

html = html.replace('</section>\r\n\r\n            <!-- 5. Profile', settingsAndPremiumHTML);
if (html.indexOf(settingsAndPremiumHTML) === -1) {
    html = html.replace('</section>\n\n            <!-- 5. Profile', settingsAndPremiumHTML);
}

// 3. Update page-profile (remove settings and premium purchase, add user info)
// Match from <section id="page-profile" class="page"> down to Referral Tizimi (exclusive)
const profileReplacement = `<section id=\"page-profile\" class=\"page\">
                <div class=\"card\" id=\"user-info-card\">
                    <div class=\"card-title\"><i class=\"fas fa-id-card\"></i> Foydalanuvchi Ma'lumotlari</div>
                    <div id=\"user-info-content\"></div>
                </div>

                <div class=\"card\">
                    <div class=\"card-title\"><i class=\"fas fa-crown\"></i> Premium Holati</div>
                    <div id=\"premium-status\">Yuklanmoqda...</div>
                    <button class=\"btn btn-primary\" style=\"margin-top: 15px; background: rgba(245, 158, 11, 0.1); border: 1px solid var(--gold); color: var(--gold);\" onclick=\"showPage('services'); showSubPage('premium');\">
                        Premium sotib olish / Uzaytirish
                    </button>
                </div>

                <div class=\"card\">
                    <div class=\"card-title\"><i class=\"fas fa-gift\"></i> Referral Tizimi</div>`;

html = html.replace(/<section id=\"page-profile\" class=\"page\">[\s\S]*?<div class=\"card\">\s*<div class=\"card-title\"><i class=\"fas fa-gift\"><\/i> Referral Tizimi<\/div>/, profileReplacement);

// 4. Move admin-card out of page-profile to page-admin
html = html.replace(/<div class=\"card\" id=\"admin-card\" style=\"display: none;\">[\s\S]*?<!-- 4. API Page -->/, 
`            <!-- Admin Page -->
            <section id=\"page-admin\" class=\"page\">
                <div class=\"card\">
                    <div class=\"card-title\"><i class=\"fas fa-user-shield\"></i> Admin Panel</div>
                    <div style=\"display: grid; grid-template-columns: 1fr 1fr; gap: 10px;\">
                        <button class=\"btn btn-ghost\" onclick=\"showPage('admin-users')\"><i class=\"fas fa-users\"></i> Foydalanuvchilar</button>
                        <button class=\"btn btn-ghost\" onclick=\"showPage('admin-sources')\"><i class=\"fas fa-rss\"></i> Manbalar</button>
                        <button class=\"btn btn-ghost\" onclick=\"showPage('admin-broadcast')\"><i class=\"fas fa-bullhorn\"></i> Broadcast</button>
                        <button class=\"btn btn-ghost\" onclick=\"showPage('admin-settings')\"><i class=\"fas fa-cogs\"></i> Sozlamalar</button>
                        <button class=\"btn btn-ghost\" onclick=\"showPage('status')\"><i class=\"fas fa-server\"></i> Tizim Statusi</button>
                        <button class=\"btn btn-ghost\" onclick=\"showPage('admin-tickets')\"><i class=\"fas fa-ticket-alt\"></i> Ticketlar</button>
                    </div>
                </div>
            </section>
            
            <!-- 4. API Page -->`);

// 5. RSS Service to Home page
const homePageReplacement = `            <!-- 1. Home Page -->
            <section id=\"page-home\" class=\"page\">
                <div class=\"card\">
                    <div class=\"card-title\"><i class=\"fas fa-chart-line\"></i> Statistika</div>
                    <div class=\"stat-grid\">
                        <div class=\"stat-card\">
                            <div class=\"stat-val\" id=\"stat-posts\">0</div>
                            <div class=\"stat-lab\">Jami Postlar</div>
                        </div>
                        <div class=\"stat-card\">
                            <div class=\"stat-val\" id=\"stat-dupes\">0</div>
                            <div class=\"stat-lab\">Dublikatlar</div>
                        </div>
                        <div class=\"stat-card\">
                            <div class=\"stat-val\" id=\"stat-sources\">0</div>
                            <div class=\"stat-lab\">Manbalar</div>
                        </div>
                        <div class=\"stat-card\">
                            <div class=\"stat-val\" id=\"stat-refs\">0</div>
                            <div class=\"stat-lab\">Referrallar</div>
                        </div>
                    </div>
                </div>

                <div class=\"card\">
                    <div class=\"card-title\"><i class=\"fas fa-rss\"></i> Bot Asosiy Xizmatlari</div>
                    <button class=\"btn btn-primary\" style=\"margin-bottom: 10px;\" onclick=\"showPage('content')\"><i class=\"fas fa-plus\"></i> Yangi RSS/Kanal qo'shish</button>
                    <button class=\"btn btn-ghost\" style=\"margin-bottom: 10px;\" onclick=\"showPage('content'); setTimeout(() => document.getElementById('ai-prompt').focus(), 100);\"><i class=\"fas fa-robot\"></i> AI Post Yaratish</button>
                </div>

                <div class=\"card\">
                    <div class=\"card-title\"><i class=\"fas fa-clock\"></i> Navbatdagi Postlar</div>
                    <div id=\"scheduled-list\"></div>
                </div>
            </section>`;
html = html.replace(/<!-- 1\. Home Page -->[\s\S]*?<!-- 2\. Content Page \(RSS \+ AI \+ Channels\) -->/, homePageReplacement + '\n\n            <!-- 2. Content Page (RSS + AI + Channels) -->');

            
fs.writeFileSync('public/index.html', html, 'utf8');
console.log('HTML file successfully updated.');
