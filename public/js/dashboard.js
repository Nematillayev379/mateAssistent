
        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function escapeAttr(str) {
            return escapeHtml(str).replace(/`/g, '&#96;');
        }

        function safeUrl(url) {
            if (!url) return '#';
            try {
                const parsed = new URL(String(url), window.location.origin);
                if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
            } catch (_) {}
            return '#';
        }

        function escapeJsString(str) {
            return String(str || '')
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/\r/g, '\\r')
                .replace(/\n/g, '\\n');
        }

        function showToast(msg, type) {
            type = type || 'info';
            const toast = document.createElement('div');
            toast.className = 'toast toast-' + type;
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3000);
        }
        function tt(key, fallback) {
            if (typeof t === 'function') {
                const value = t(key);
                if (value && value !== key) return value;
            }
            return fallback || key;
        }

        let userData = null;
        let token = localStorage.getItem('bot_token');
        let userId = localStorage.getItem('bot_user_id');
        let selectedPayMethod = 'stars';
        let premiumMonthlyUZS = 25000;
        let premiumYearlyUZS = 250000;
        let premiumMonthlyStars = 500;
        let premiumYearlyStars = 5000;
        let adminUsersCache = [];
        let adminUserFilter = 'all';
        let tonConnectUi = null;



        function apiFetch(resource, options = {}) {
            const headers = {
                'x-bot-token': token,
                ...(options.headers || {})
            };
            if (userId) headers['x-user-id'] = userId;
            return fetch(resource, { ...options, headers });
        }

        
        function applyLocalizedUi() {
            const quickLang = document.getElementById('quick-lang')?.value || userData?.user?.language || 'uz';
            const map = [
                ['#wallet-copy', tt('wallet_section_body', 'Connect a TON wallet to unlock your web3 profile layer inside the mini app.')],
                ['#wallet-connection-label', tt('wallet_connection', 'Wallet connection')],
                ['#post-language-label', tt('post_language', 'Post language')],
                ['#voice-title-label', tt('voice_title_label', 'Title')],
                ['#voice-text-label', tt('voice_text_label', 'Text')],
                ['label[for="voice-to-channel"]', tt('voice_send_channel', 'Send to channel')],
                ['#btn-voice-generate', tt('voice_generate', 'Generate audio and send')],
                ['#search-product-query', tt('search_placeholder', 'Enter product name')],
                ['#btn-search-product', tt('search_button', 'Search')],
                ['#music-q', tt('music_search_placeholder', 'Artist or song...')],
                ['#wallet-analytics-title', tt('analytics_section_title', 'Analytics Hub')],
                ['#finance-card-title', tt('finance_title', 'Financial Markets')],
                ['#trends-card-title', tt('trends_title', 'Google Trends')],
            ];
            map.forEach(([selector, value]) => {
                const el = document.querySelector(selector);
                if (!el) return;
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') el.placeholder = value;
                else el.textContent = value;
            });
            const postLang = document.getElementById('post-lang');
            if (postLang) postLang.value = quickLang;
        }

        function updateWalletUi(account) {
            const stateEl = document.getElementById('wallet-connection-state');
            const addressEl = document.getElementById('wallet-address');
            if (account && account.address) {
                const shortAddress = `${account.address.slice(0, 8)}...${account.address.slice(-6)}`;
                if (stateEl) stateEl.textContent = `${tt('wallet_connected', 'Connected')}: ${shortAddress}`;
                if (addressEl) addressEl.textContent = account.address;
            } else {
                if (stateEl) stateEl.textContent = tt('wallet_not_connected', 'Not connected');
                if (addressEl) addressEl.textContent = '';
            }
        }

        async function initTonWalletUi() {
            if (tonConnectUi || !window.TON_CONNECT_UI) return;
            try {
                tonConnectUi = new window.TON_CONNECT_UI.TonConnectUI({
                    manifestUrl: `${window.location.origin}/tonconnect-manifest.json`,
                    buttonRootId: 'ton-connect',
                });
                updateWalletUi(tonConnectUi.wallet?.account || null);
                tonConnectUi.onStatusChange((wallet) => {
                    updateWalletUi(wallet?.account || null);
                });
            } catch (e) {
                console.error('TON Connect init failed', e);
            }
        }

        const tg = window.Telegram?.WebApp;
        if (tg && tg.initData) {
            tg.expand();
            tg.ready();
            fetch('/api/auth/telegram', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ initData: tg.initData })
            }).then(async res => {
                if (!res.ok) throw new Error('Auth fail');
                return res.json();
            }).then(data => {
                token = data.token;
                userId = String(data.userId);
                localStorage.setItem('bot_token', token);
                localStorage.setItem('bot_user_id', userId);
                login(token);
            }).catch(() => {
                document.getElementById('auth-status').textContent = 'Kirishda xatolik. Kalitni yozing.';
                document.getElementById('manual-login').style.display = 'block';
            });
        } else {
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('token')) {
                token = urlParams.get('token'); userId = urlParams.get('user');
                localStorage.setItem('bot_token', token);
                window.history.replaceState({}, '', '/dashboard?user=' + userId);
            }
            if (token) login(token);
            else {
                document.getElementById('auth-status').textContent = 'Admin panelga xush kelibsiz!';
                document.getElementById('manual-login').style.display = 'block';
            }
        }

        async function login(k) {
            const key = k || document.getElementById('auth-key')?.value;
            if (!key) return;
            try {
                if (!userId) {
                    const r = await fetch('/api/auth/master', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: key }) });
                    if (r.ok) { const d = await r.json(); userId = d.userId; token = d.token; }
                }
                const res = await apiFetch(`/api/dashboard-info?userId=${userId}`, { headers: { 'x-bot-token': key } });
                if (!res.ok) throw new Error('Kalit noto\'g\'ri!');
                userData = await res.json();
                token = key;
                localStorage.setItem('bot_token', token);
                if (userId) localStorage.setItem('bot_user_id', userId);
                renderUI();
                document.getElementById('auth-screen').style.display = 'none';
                document.getElementById('app').style.display = 'block';
                showPage('overview');
            } catch(e) { showToast(e.message, 'error'); localStorage.removeItem('bot_token'); }
        }

        function isAdminUser(u) {
            return u && (u.role === 'owner' || u.role === 'admin' || u.is_owner);
        }

        async function changeQuickLanguage(language) {
            const setLang = document.getElementById('set-lang');
            const postLang = document.getElementById('post-lang');
            if (setLang) setLang.value = language;
            if (postLang) postLang.value = language;
            if (window.WebAppI18n) WebAppI18n.setLang(language);
            applyLocalizedUi();
            if (userData?.user) userData.user.language = language;
            if (userId && token) {
                await apiFetch(`/api/settings/${userId}/extended`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-bot-token': token },
                    body: JSON.stringify({ language })
                }).catch(() => {});
            }
        }

        function updatePriceDisplay() {
            const pm = document.getElementById('price-monthly');
            const py = document.getElementById('price-yearly');
            if (selectedPayMethod === 'stars') {
                if (pm) pm.textContent = premiumMonthlyStars + ' Stars';
                if (py) py.textContent = premiumYearlyStars + ' Stars';
            } else {
                if (pm) pm.textContent = premiumMonthlyUZS + ' UZS';
                if (py) py.textContent = premiumYearlyUZS + ' UZS';
            }
        }

        function setPayMethod(method) {
            selectedPayMethod = method;
            document.querySelectorAll('.pay-method-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.method === method);
                btn.style.borderColor = btn.dataset.method === method ? 'var(--accent)' : 'var(--border)';
            });
            updatePriceDisplay();
        }

        async function loadPaymentMethods() {
            const container = document.getElementById('pay-methods-container');
            if (!container) return;
            try {
                // BUG-4XX Fix: Pass x-user-id header so checkAuth can validate the token against the correct userId
                const res = await apiFetch('/api/payments/methods', { headers: { 'x-bot-token': token, 'x-user-id': userId || '' } });
                const methods = res.ok ? await res.json() : { stars: true, payme: false, click: false };
                const defs = [
                    { id: 'stars', key: 'pay_stars', label: 'â­ Stars' },
                    { id: 'payme', key: 'pay_payme', label: 'Payme' },
                    { id: 'click', key: 'pay_click', label: 'Click' },
                ];
                container.innerHTML = '';
                defs.forEach((d) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn btn-ghost pay-method-btn' + (selectedPayMethod === d.id ? ' active' : '');
                    btn.dataset.method = d.id;
                    btn.style.cssText = 'width:auto;padding:8px 12px;font-size:0.8rem;';
                    
                    const isConfigured = methods[d.id];
                    // Always show the button, but mark as Demo if not configured in environment variables
                    btn.textContent = (typeof t === 'function' ? t(d.key) : d.label) + (!isConfigured ? ' (Demo)' : '');
                    btn.onclick = () => setPayMethod(d.id);
                    container.appendChild(btn);
                });
            } catch (_) {
                container.innerHTML = `
                    <button type="button" class="btn btn-ghost pay-method-btn active" data-method="stars" onclick="setPayMethod('stars')">â­ Stars</button>
                    <button type="button" class="btn btn-ghost pay-method-btn" data-method="payme" onclick="setPayMethod('payme')">Payme (Demo)</button>
                    <button type="button" class="btn btn-ghost pay-method-btn" data-method="click" onclick="setPayMethod('click')">Click (Demo)</button>
                `;
            }
        }

        async function adminUserAction(telegramId, action) {
            const routes = {
                approve: `/api/admin/users/${telegramId}/approve`,
                reject: `/api/admin/users/${telegramId}/reject`,
                block: `/api/admin/users/${telegramId}/block`,
                unblock: `/api/admin/users/${telegramId}/unblock`,
                premium: `/api/admin/users/${telegramId}/premium`,
                revoke: `/api/admin/users/${telegramId}/premium`,
            };
            const url = routes[action];
            if (!url) return;
            // BUG-3XX Fix: days=0 â†’ revoke premium via existing revokePremium endpoint
            const body = (action === 'premium' || action === 'revoke')
              ? JSON.stringify({ days: action === 'revoke' ? 0 : 30 })
              : undefined;
            const res = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body });
            if (res.ok) {
                showToast(
                  typeof t === 'function'
                    ? t('admin_premium_ok')
                    : (action === 'revoke' ? 'Premium bekor qilindi' : 'OK'),
                  'success'
                );
                fetchAdminUsers();
            } else {
                showToast(typeof t === 'function' ? t('common_error') : 'Error', 'error');
            }
        }

        function renderAdminUsersList(users) {
            const list = document.getElementById('admin-users-list');
            if (!list) return;
            list.innerHTML = '';
            const filtered = users.filter((u) => {
                if (adminUserFilter === 'pending') return !u.is_approved;
                if (adminUserFilter === 'blocked') return u.is_active === 0 || u.is_active === false;
                if (adminUserFilter === 'premium') return !!u.is_premium;
                return true;
            });
            filtered.forEach((u) => {
                const approved = u.is_approved === 1 || u.is_approved === true;
                const active = u.is_active !== 0 && u.is_active !== false;
                const rss = u.sources?.length ? u.sources.map(s => s.name || s.url).join(', ') : t('no');
                const card = document.createElement('div');
                card.className = 'item-row';
                card.style.cssText = 'flex-direction:column;align-items:flex-start;gap:8px;';
                card.innerHTML = `
                    <div style="display:flex;justify-content:space-between;width:100%;align-items:center;">
                        <h4>${escapeHtml(u.username || u.first_name || u.telegram_id)}</h4>
                        <span style="font-size:0.75rem;">
                            <span class="admin-badge ${approved ? 'approved' : 'pending'}">${approved ? t('admin_status_approved') : t('admin_status_pending')}</span>
                            ${!active ? `<span class="admin-badge blocked">${t('admin_status_blocked')}</span>` : ''}
                            <span style="background:var(--accent);padding:2px 6px;border-radius:4px;margin-left:4px;">${escapeHtml(u.role)} | ${u.is_premium ? 'Premium' : t('free')}</span>
                        </span>
                    </div>
                    <div style="font-size:0.8rem;color:var(--secondary);word-break:break-all;">
                        <p><strong>ID:</strong> ${escapeHtml(u.telegram_id)}</p>
                        <p><strong>RSS:</strong> ${escapeHtml(rss)}</p>
                        <p><strong>${t('home_target')}:</strong> ${escapeHtml(u.target_channel || t('not_set'))}</p>
                    </div>
                    <div class="admin-actions">
                        ${!approved ? `<button class="btn btn-ghost" onclick="adminUserAction(${u.telegram_id},'approve')">${t('admin_approve')}</button>` : ''}
                        ${approved ? `<button class="btn btn-ghost" onclick="adminUserAction(${u.telegram_id},'reject')">${t('admin_reject')}</button>` : ''}
                        ${active ? `<button class="btn btn-ghost" style="color:var(--danger)" onclick="adminUserAction(${u.telegram_id},'block')">${t('admin_block')}</button>` : `<button class="btn btn-ghost" style="color:var(--success)" onclick="adminUserAction(${u.telegram_id},'unblock')">${t('admin_unblock')}</button>`}
                        <button class="btn btn-ghost" onclick="adminUserAction(${u.telegram_id},'premium')">Premium (30 k)</button>
                        ${u.is_premium ? `<button class="btn btn-ghost" style="color:var(--danger)" onclick="adminUserAction(${u.telegram_id},'revoke')">Bekor qilish</button>` : ''}
                        <button class="btn btn-ghost" onclick="changeUserRole(${u.telegram_id})">${t('admin_change_role')}</button>
                    </div>`;
                list.appendChild(card);
            });
        }

        function setupAdminUserFilters() {
            const box = document.getElementById('admin-users-filters');
            if (!box || box.dataset.ready) return;
            box.dataset.ready = '1';
            [['all','admin_users'],['pending','admin_status_pending'],['blocked','admin_status_blocked'],['premium','premium_title']].forEach(([id, key]) => {
                const label = typeof t === 'function' ? t(key) : id;
                const b = document.createElement('button');
                b.className = 'btn btn-ghost';
                b.style.cssText = 'width:auto;padding:6px 10px;font-size:0.72rem;';
                b.textContent = label;
                b.onclick = () => { adminUserFilter = id; renderAdminUsersList(adminUsersCache); };
                box.appendChild(b);
            });
        }

        const lazyLoaded = {
            sources: false,
            settings: false,
            apiKeys: false,
            tickets: false,
            prices: false,
            channels: false,
            referral: false,
            premium: false,
            paymentMethods: false,
        };

function renderUI() {
             const u = userData.user || {};
             const displayName = u.username || u.first_name || u.telegram_id || u.id || 'User';
             const roleLabel = u.role === 'owner' ? ' ðŸ‘‘ Owner' : (u.role === 'admin' ? ' ðŸ›¡ Admin' : '');
             document.getElementById('user-name').textContent = displayName + roleLabel;
             if (u.is_premium) {
                 document.documentElement.classList.add('premium-active');
                 const badge = document.getElementById('user-premium-badge');
                 if (badge) badge.style.display = 'flex';
             } else {
                 document.documentElement.classList.remove('premium-active');
             }
             if (isAdminUser(u)) {
                  const adminCard = document.getElementById('admin-card');
                  if (adminCard) adminCard.style.display = 'block';
                  const adminNav = document.getElementById('nav-admin');
                  if (adminNav) adminNav.style.display = 'flex';
              } else {
                  const adminCard = document.getElementById('admin-card');
                  if (adminCard) adminCard.style.display = 'none';
                  const adminNav = document.getElementById('nav-admin');
                  if (adminNav) adminNav.style.display = 'none';
              }

            document.getElementById('stat-posts').textContent = userData.stats?.total_posts || 0;
            document.getElementById('stat-dupes').textContent = userData.stats?.total_duplicates || 0;
            document.getElementById('stat-refs').textContent = userData.referrals?.total || 0;
            
            document.getElementById('set-channel').value = u.target_channel || '';
            document.getElementById('set-lang').value = u.language || 'uz';
            const quickLang = document.getElementById('quick-lang');
            const postLang = document.getElementById('post-lang');
            if (quickLang) quickLang.value = u.language || 'uz';
            if (postLang) postLang.value = u.language || 'uz';
            document.getElementById('set-interval').value = String(u.interval_minutes || 15);
            const walletState = document.getElementById('wallet-membership-state');
            if (walletState) walletState.textContent = u.is_premium ? tt('elite', 'ELITE') : tt('free', 'Free');

            const homeTarget = document.getElementById('home-target-channel');
            if (homeTarget) homeTarget.textContent = u.target_channel || (tt('not_set', 'Sozlanmagan') + ' âš ï¸');

            // UI-5 Fix: Display full user info - connected RSS and channel
            const userInfo = document.getElementById('user-info') || document.createElement('div');
            userInfo.id = 'user-info';
            userInfo.style.cssText = 'background: rgba(255,255,255,0.03); padding: 15px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 16px;';
            userInfo.innerHTML = `
                <div style="font-size: 0.85rem; color: var(--secondary); margin-bottom: 8px;">${tt('home_user_info', 'Identity Snapshot')}</div>
                <div class="item-row"><span>${tt('home_telegram_id', 'Telegram ID')}</span><span>${escapeHtml(u.telegram_id || tt('unknown', 'Noma\'lum'))}</span></div>
                <div class="item-row"><span>${tt('home_username', 'Username')}</span><span>${escapeHtml(u.username || tt('unknown', 'Noma\'lum'))}</span></div>
                <div class="item-row"><span>${tt('home_target', 'Target Channel')}</span><span>${escapeHtml(u.target_channel || tt('not_set', 'Not connected'))}</span></div>
                <div class="item-row"><span>${tt('home_language', 'Language')}</span><span>${escapeHtml(u.language || 'uz')}</span></div>
                <div class="item-row"><span>${tt('home_role', 'Role')}</span><span>${escapeHtml(u.role || tt('user_default', 'user'))}</span></div>
                <div class="item-row"><span>${tt('home_premium', 'Premium')}</span><span>${u.is_premium ? tt('yes', 'Ha') : tt('no', 'Yo\'q')}</span></div>
            `;
            const profileInfoContainer = document.getElementById('user-info-content');
            if (profileInfoContainer) {
                profileInfoContainer.innerHTML = userInfo.innerHTML;
            }

            const sch = document.getElementById('scheduled-list');
            sch.innerHTML = '';
            if (userData.scheduled?.length) {
                userData.scheduled.slice(0, 3).forEach(p => {
                    sch.innerHTML += `<div class="item-row"><div><h4>${p.type.toUpperCase()}</h4><p>${new Date(p.scheduled_at).toLocaleTimeString()}</p></div><button class="btn btn-ghost" style="width:auto; padding:4px 8px; color:var(--danger);" onclick="cancelScheduled(${p.id})">âŒ</button></div>`;
                });
            } else sch.innerHTML = `<p style="color:var(--secondary); font-size:0.8rem">${tt('home_no_scheduled', 'Navbatda postlar yo\'q.')}</p>`;

            fetchSources();
            if (window.WebAppI18n) {
                WebAppI18n.init(u.language || localStorage.getItem('webapp_lang') || 'uz');
                WebAppI18n.apply();
            }
            applyLocalizedUi();
            initTonWalletUi();
        }

        async function fetchSources() {
            const r = await apiFetch(`/api/sources/${userId}`, { headers: { 'x-bot-token': token } });
            const data = await r.json();
            document.getElementById('stat-sources').textContent = data.length || 0;
            
            // Home page sources
            const homeSourcesList = document.getElementById('home-sources-list');
            if (homeSourcesList) {
                homeSourcesList.innerHTML = '';
                if (Array.isArray(data) && data.length > 0) {
                    data.slice(0, 3).forEach(s => {
                        homeSourcesList.innerHTML += `<div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); padding:6px 10px; border-radius:6px; border:1px solid var(--border); margin-bottom: 6px;">
                            <span>ðŸŸ¢ ${escapeHtml(s.name)}</span>
                            <span style="font-size:0.75rem; color:var(--secondary);">${escapeHtml((s.lang || '').toUpperCase())}</span>
                        </div>`;
                    });
                    if (data.length > 3) {
                        homeSourcesList.innerHTML += `<div style="text-align:center; font-size:0.75rem; color:var(--secondary); margin-top:4px;">va yana ${data.length - 3} ta manba...</div>`;
                    }
                } else {
                    homeSourcesList.innerHTML = `<span style="color:var(--secondary); font-size:0.8rem;">${tt('home_no_sources', "Faol manbalar yo'q.")}</span>`;
                }
            }

            const list = document.getElementById('sources-list');
            list.innerHTML = '';
            if (Array.isArray(data)) {
                data.forEach(s => {
                    const previewUrl = String(s.url || '').slice(0, 30);
                    list.innerHTML += `<div class="item-row"><div><h4>${escapeHtml(s.name)}</h4><p>${escapeHtml(previewUrl)}...</p></div><i class="fas fa-trash" style="color:var(--danger)" onclick="deleteSource(${Number(s.id)})"></i></div>`;
                });
            }
        }

        async function saveSource() {
            const name = document.getElementById('src-name').value;
            const url = document.getElementById('src-url').value;
            if (!name || !url) return;
            const res = await apiFetch(`/api/sources/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ name, url }) });
            if (res.ok) { document.getElementById('src-name').value = ''; document.getElementById('src-url').value = ''; fetchSources(); }
        }

        async function deleteSource(id) {
            if (confirm('O\'chirilsinmi?')) {
                await apiFetch(`/api/sources/${userId}/${id}`, { method: 'DELETE', headers: { 'x-bot-token': token } });
                fetchSources();
            }
        }

        async function generateAIPost() {
            const prompt = document.getElementById('ai-prompt').value;
            if (!prompt) {
                showToast('Iltimos mavzu kiriting!', 'error');
                return;
            }
            const btn = document.getElementById('btn-ai'); 
            const originalInnerHTML = btn.innerHTML;
            btn.disabled = true; 
            btn.innerHTML = document.getElementById('ai-image').checked
                ? '<i class="fas fa-spinner fa-spin"></i> Matn va rasm tayyorlanmoqda...'
                : '<i class="fas fa-spinner fa-spin"></i> Matn tayyorlanmoqda...';
            try {
                const language = document.getElementById('post-lang')?.value || userData?.user?.language || 'uz';
                const res = await apiFetch('/api/ai/smm', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ prompt, language, withImage: document.getElementById('ai-image').checked }) });
                if (!res.ok) {
                    const error = await res.json();
                    throw new Error(error.error || 'Xatolik yuz berdi');
                }
                const data = await res.json();
                if (!data.text || data.text.length < 10) {
                    throw new Error('AI post yaratmadi. API kalitlarini tekshiring (GROQ/GEMINI).');
                }
                document.getElementById('ai-result').style.display = 'block';
                document.getElementById('ai-res-text').textContent = data.text;
                // Add copy button
                const copyBtn = document.getElementById('ai-copy-btn');
                if (copyBtn) copyBtn.style.display = 'inline-block';
                const img = document.getElementById('ai-res-img');
                lastSmmImageBase64 = data.imageBase64 || null;
                const imgSrc = data.imageBase64 || data.imageUrl;
                if (imgSrc) {
                    img.onload = () => { img.style.display = 'block'; };
                    img.onerror = () => {
                        img.style.display = 'none';
                        if (data.imageUrl && data.imageUrl !== imgSrc) {
                            img.src = data.imageUrl;
                            img.style.display = 'block';
                        }
                    };
                    img.src = imgSrc;
                    img.style.display = 'block';
                } else {
                    img.style.display = 'none';
                }
            } catch (error) {
                showToast('Xatolik: ' + error.message, 'error');
                document.getElementById('ai-result').style.display = 'none';
            } finally { 
                btn.disabled = false; 
                btn.innerHTML = originalInnerHTML; 
            }
        }

        function copyAIPostText() {
            const text = document.getElementById('ai-res-text').textContent;
            navigator.clipboard.writeText(text).then(() => {
                showToast('Post matni nusxalandi!', 'success');
            }).catch(() => {
                showToast('Nusxalash muvaffaqiyatsiz', 'error');
            });
        }

        let lastSmmImageBase64 = null;

        async function sendAIPostToChannel() {
            const text = document.getElementById('ai-res-text').textContent;
            const img = document.getElementById('ai-res-img');
            const imageBase64 = img.style.display === 'block' && img.src?.startsWith('data:') ? img.src : lastSmmImageBase64;
            const imageUrl = img.style.display === 'block' && img.src?.startsWith('http') ? img.src : null;
            if (!text) return;
            const btn = document.getElementById('btn-send-ai');
            btn.disabled = true;
            try {
                const res = await apiFetch('/api/ai/post-to-channel', { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, 
                    body: JSON.stringify({ text, imageUrl, imageBase64 }) 
                });
                if (res.ok) showToast('Post kanalga yuborildi!', 'success');
                else showToast('Xatolik yuz berdi', 'error');
            } catch(e) { showToast(e.message, 'error'); }
            finally { btn.disabled = false; }
        }

        function extractYouTubeId(urlOrId) {
            if (!urlOrId) return '';
            if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;
            const m = String(urlOrId).match(/(?:v=|\/)([a-zA-Z0-9_-]{11})(?:[&?#/]|$)/);
            return m ? m[1] : '';
        }

        function triggerBrowserDownload(blob, filename) {
            const a = document.createElement('a');
            const href = URL.createObjectURL(blob);
            a.href = href;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(href), 2000);
        }

        async function searchMusic() {
            const q = document.getElementById('music-q').value;
            if (!q) return;
            const list = document.getElementById('music-list'); list.innerHTML = '<p>Qidirilmoqda...</p>';
            const res = await apiFetch(`/api/music/search?q=${encodeURIComponent(q)}`, { headers: { 'x-bot-token': token } });
            const data = await res.json();
            list.innerHTML = '';
            if (!data.length) {
                list.innerHTML = '<p style="color:var(--secondary)">Natija topilmadi</p>';
                return;
            }
            data.forEach(m => {
                const safeTitle = (m.title || 'music').replace(/'/g, '');
                list.innerHTML += `<div class="item-row" style="flex-wrap: wrap;"><div><h4>${escapeHtml(m.title || '')}</h4></div><div style="display:flex;gap:6px;"><button class="btn btn-primary" style="width:auto; padding:8px 12px;" onclick="downloadM('${m.videoId || extractYouTubeId(m.url)}', '${safeTitle}', this)"><i class="fas fa-download"></i></button><button class="btn btn-ghost" style="width:auto; padding:8px 12px;" onclick="downloadAndSendMusic('${m.videoId || extractYouTubeId(m.url)}', '${safeTitle}', this)"><i class="fas fa-paper-plane"></i></button></div></div>`;
            });
        }

        async function downloadM(videoId, title, btnEl) {
            const id = extractYouTubeId(videoId);
            if (!id) {
                showToast('Video ID topilmadi', 'error');
                return;
            }
            const btn = btnEl || event?.target?.closest('button');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
            try {
                const res = await apiFetch(`/api/music/download/${id}?web=1`, { headers: { 'x-bot-token': token } });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || 'Yuklab olish muvaffaqiyatsiz');
                }
                const blob = await res.blob();
                triggerBrowserDownload(blob, `${title || 'music'}.m4a`);
            } catch (e) {
                showToast('Xatolik: ' + e.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i>'; }
            }
        }

        async function downloadAndSendMusic(videoId, title, btnEl) {
            const id = extractYouTubeId(videoId);
            if (!id) {
                showToast('Video ID topilmadi', 'error');
                return;
            }
            const btn = btnEl || event?.target?.closest('button');
            if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
            try {
                const res = await apiFetch(`/api/music/download/${id}?send=1`, { headers: { 'x-bot-token': token } });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || 'Yuklab olish muvaffaqiyatsiz');
                }
                const data = await res.json();
                if (data.success) {
                    showToast(data.message || 'Musiqa kanalga yuborildi!', 'success');
                } else {
                    throw new Error(data.error || 'Yuborish muvaffaqiyatsiz');
                }
            } catch (e) {
                showToast('Xatolik: ' + e.message, 'error');
            } finally {
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i>'; }
            }
        }

        async function downloadMedia(type, btnEl) {
            const url = document.getElementById('dl-url').value.trim();
            if (!url) {
                showToast('Iltimos havola kiriting', 'error');
                return;
            }
            const videoBtn = document.getElementById('btn-dl-video');
            const audioBtn = document.getElementById('btn-dl-audio');
            const originalBtn = btnEl?.innerHTML;
            
            // Disable both buttons and show spinner
            if (videoBtn) videoBtn.disabled = true;
            if (audioBtn) audioBtn.disabled = true;
            if (btnEl) btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Yuklanmoqda...';
            
            const ext = type === 'video' ? 'mp4' : 'm4a';
            try {
                const res = await apiFetch('/api/media/download?web=1', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-bot-token': token },
                    body: JSON.stringify({ url, type, delivery: 'web' })
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || 'Yuklab olish muvaffaqiyatsiz');
                }
                const contentType = res.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const err = await res.json();
                    throw new Error(err.error || 'Server xatosi');
                }
                const blob = await res.blob();
                if (blob.size < 1000) throw new Error('Fayl juda kichik â€” yuklash muvaffaqiyatsiz');
                triggerBrowserDownload(blob, `media_${Date.now()}.${ext}`);
            } catch (e) {
                showToast('Xatolik: ' + e.message, 'error');
            } finally {
                // Re-enable both buttons
                if (videoBtn) videoBtn.disabled = false;
                if (audioBtn) audioBtn.disabled = false;
                if (btnEl) btnEl.innerHTML = originalBtn;
            }
        }

        async function loadFinance() {
            const res = await apiFetch('/api/finance/prices', { headers: { 'x-bot-token': token } });
            const data = await res.json();
            document.getElementById('f-btc').textContent = '$' + data.btc;
            document.getElementById('f-usd').textContent = data.usd + ' so\'m';
        }

        async function saveSettings() {
            const language = document.getElementById('set-lang').value;
            const target_channel = document.getElementById('set-channel').value;
            const keywords = document.getElementById('set-keywords').value;
            const interval_minutes = Math.max(1, Math.min(1440, parseInt(document.getElementById('set-interval').value || '15', 10) || 15));
            const daily_digest = document.getElementById('set-digest').value === 'true';
            const digest_time = document.getElementById('set-digest-time').value;
            const res = await apiFetch(`/api/settings/${userId}/extended`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ language, target_channel, keywords, interval_minutes, daily_digest, digest_time }) });
            if (res.ok) {
                userData.user.language = language;
                userData.user.target_channel = target_channel;
                userData.user.interval_minutes = interval_minutes;
                if (window.WebAppI18n) WebAppI18n.setLang(language);
                showToast(typeof t === 'function' ? t('common_lang_changed') : 'Saved!', 'success');
                renderUI();
                if (tg?.HapticFeedback?.notificationOccurred) {
                    tg.HapticFeedback.notificationOccurred('success');
                }
            } else {
                const err = await res.json().catch(() => ({}));
                showToast(err.error || (typeof t === 'function' ? t('common_error') : 'Error'), 'error');
            }
        }

        async function loadSystemStatus() {
            const res = await apiFetch('/api/admin/system');
            if (!res.ok) {
                showToast('Tizim statusini yuklab bo\'lmadi (admin huquqi kerak)', 'error');
                return;
            }
            const data = await res.json();
            document.getElementById('sys-uptime').textContent = Math.floor(data.uptime / 3600) + ' soat';
            document.getElementById('sys-redis').textContent = data.redis ? 'Online' : 'Offline';
            document.getElementById('sys-node').textContent = data.nodeVersion || '--';
        }

        function showPage(p) {
            document.querySelectorAll('.page').forEach(page => page.style.display = 'none');
            document.querySelectorAll('[id^="subpage-"]').forEach(subpage => subpage.style.display = 'none');
            const targetPage = document.getElementById('page-' + p);
            if (targetPage) targetPage.style.display = 'block';
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            // BUG-5XX Fix: Highlight nav-admin when on any admin page (nav-admin-users does not exist as a static element)
            const adminPages = ['admin-users', 'admin-sources', 'admin-broadcast', 'admin-settings', 'admin-tickets'];
            if (adminPages.includes(p)) {
                const adminNavItem = document.getElementById('nav-admin');
                if (adminNavItem) adminNavItem.classList.add('active');
            } else {
                document.getElementById('nav-' + p)?.classList.add('active');
            }
            if (p === 'overview') {
                if (!lazyLoaded.sources) {
                    lazyLoaded.sources = true;
                    fetchSources();
                }
            }
            if (p === 'sources') {
                if (!lazyLoaded.sources) {
                    lazyLoaded.sources = true;
                    fetchSources();
                }
                if (!lazyLoaded.prices) {
                    lazyLoaded.prices = true;
                    fetchTrackedPrices();
                }
                if (!lazyLoaded.channels) {
                    lazyLoaded.channels = true;
                    fetchChannels();
                }
                loadOutputChannels();
                if (!lazyLoaded.settings) {
                    lazyLoaded.settings = true;
                    fetchExtendedSettings();
                }
            }
            if (p === 'settings') {
                if (!lazyLoaded.referral) {
                    lazyLoaded.referral = true;
                    fetchReferralInfo();
                }
                if (!lazyLoaded.tickets) {
                    lazyLoaded.tickets = true;
                    fetchTickets();
                }
                if (!lazyLoaded.apiKeys) {
                    lazyLoaded.apiKeys = true;
                    fetchApiKeys();
                }
                if (!lazyLoaded.premium) {
                    lazyLoaded.premium = true;
                    fetchPremiumStatus();
                }
                if (!lazyLoaded.paymentMethods) {
                    lazyLoaded.paymentMethods = true;
                    loadPaymentMethods();
                }
                loadTrends(false);
                loadFinance();
            }
            if (p === 'status') loadSystemStatus();
            if (p === 'admin-users') fetchAdminUsers();
            if (p === 'admin-sources') fetchAdminSources();
            if (p === 'admin-tickets') fetchAdminTickets();
            if (p === 'admin-settings') fetchAdminSettings();
            window.scrollTo(0,0);
        }

        function showSubPage(p) {
            const sm = document.getElementById('services-menu');
            if (sm) sm.style.display = 'none';
            document.querySelectorAll('[id^="subpage-"]').forEach(subpage => subpage.style.display = 'none');
            const subpage = document.getElementById('subpage-' + p);
            if (subpage) {
                subpage.style.display = 'block';
                const sp = document.getElementById('page-services');
                if (sp) sp.style.display = 'block';
            }
            // Fix nav active state
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            document.getElementById('nav-services')?.classList.add('active');
            if (p === 'finance') loadFinance();
            if (p === 'settings' && !lazyLoaded.settings) {
                lazyLoaded.settings = true;
                fetchExtendedSettings();
            }
            if (p === 'tracker' && !lazyLoaded.prices) {
                lazyLoaded.prices = true;
                fetchTrackedPrices();
            }
            if (p === 'premium') {
                if (!lazyLoaded.premium) {
                    lazyLoaded.premium = true;
                    fetchPremiumStatus();
                }
                if (!lazyLoaded.paymentMethods) {
                    lazyLoaded.paymentMethods = true;
                    loadPaymentMethods();
                }
            }
            window.scrollTo(0,0);
        }

        async function fetchExtendedSettings() {
            try {
                const r = await apiFetch(`/api/settings/${userId}/extended`, { headers: { 'x-bot-token': token } });
                if (!r.ok) throw new Error('Settings fetch failed: ' + r.status);
                const data = await r.json();
                document.getElementById('set-keywords').value = data.keywords || '';
                document.getElementById('set-interval').value = String(data.interval_minutes || 15);
                document.getElementById('set-digest').value = data.daily_digest ? 'true' : 'false';
                document.getElementById('set-digest-time').value = data.digest_time || '20:00';
            } catch (e) {
                console.error('fetchExtendedSettings error:', e);
            }
        }

        async function fetchApiKeys() {
            const r = await apiFetch(`/api/keys/${userId}`, { headers: { 'x-bot-token': token } });
            const data = await r.json();
            const list = document.getElementById('api-keys-list');
            list.innerHTML = '';
            const canManage = isAdminUser(userData?.user || {});
            const form = document.getElementById('api-key-form');
            const addBtn = document.getElementById('btn-add-api-key');
            if (form) form.style.display = canManage ? 'block' : 'none';
            if (addBtn) addBtn.style.display = canManage ? 'flex' : 'none';
            if (Array.isArray(data)) {
                if (!data.length) {
                    list.innerHTML = `<p style="color:var(--secondary);font-size:0.85rem;">${tt('api_keys_empty', 'No API keys added yet.')}</p>`;
                    return;
                }
                const items = data.map(k => {
                    const raw = k.api_key || '';
                    const safeKey = raw.length > 10 ? `${raw.slice(0, 6)}...${raw.slice(-4)}` : 'Noma\'lum';
                    return `
                        <div class="item-row" style="align-items:flex-start; gap:12px;">
                            <div style="flex:1;">
                                <h4>${escapeHtml(k.api_type || 'Kalit')}</h4>
                                <p style="font-size:0.78rem; color:var(--secondary);">${escapeHtml(safeKey)}</p>
                                <p style="font-size:0.72rem; color:var(--secondary); margin-top:4px;">ID: ${k.id || '-'} | ${k.is_active === false ? 'Inactive' : 'Active'}</p>
                            </div>
                            ${canManage ? `<button class="btn btn-ghost" style="width:auto; padding:7px 10px; color:var(--danger);" onclick="deleteApiKey(${k.id})"><i class="fas fa-trash"></i></button>` : ''}
                        </div>`;
                }).join('');
                list.innerHTML = `
                    <details class="key-accordion">
                        <summary>
                            <span><i class="fas fa-layer-group" style="color:var(--accent);"></i> ${tt('api_keys_group', 'Added API keys')}</span>
                            <span style="color:var(--secondary);font-size:0.78rem;">${data.length}</span>
                        </summary>
                        <div class="key-panel">${items}</div>
                    </details>`;
            }
        }

        async function deleteApiKey(id) {
            if (confirm('Kalitni o\'chirasizmi?')) {
                const res = await apiFetch(`/api/keys/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'x-bot-token': token } });
                if (res.ok) fetchApiKeys();
            }
        }

        async function addApiKey() {
            const key = document.getElementById('api-key').value;
            const type = document.getElementById('api-key-type').value;
            if (!key) return;
            const res = await apiFetch('/api/keys', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ userId, key, type }) });
            if (res.ok) { document.getElementById('api-key').value = ''; fetchApiKeys(); }
            else {
                const err = await res.json().catch(() => ({}));
                showToast(err.error || 'API key saqlanmadi', 'error');
            }
        }

        async function fetchTickets() {
            const r = await apiFetch(`/api/tickets/${userId}`, { headers: { 'x-bot-token': token } });
            const data = await r.json();
            const list = document.getElementById('tickets-list');
            list.innerHTML = '';
            if (Array.isArray(data)) {
                data.forEach(t => {
                    list.innerHTML += `<div class="item-row"><div><h4>${escapeHtml(t.subject)}</h4><p>${escapeHtml(t.status)}</p></div></div>`;
                });
            }
        }

        async function createTicket() {
            const subject = document.getElementById('ticket-subject').value;
            const message = document.getElementById('ticket-message').value;
            if (!subject || !message) return;
            const res = await apiFetch(`/api/tickets/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ subject, message }) });
            if (res.ok) { document.getElementById('ticket-subject').value = ''; document.getElementById('ticket-message').value = ''; fetchTickets(); showToast('Ticket yuborildi!', 'success'); }
        }

        async function fetchTrackedPrices() {
            const r = await apiFetch(`/api/prices/${userId}`, { headers: { 'x-bot-token': token } });
            const data = await r.json();
            const list = document.getElementById('tracked-list');
            list.innerHTML = '';
            if (Array.isArray(data)) {
                data.forEach(p => {
                    const numericPrice = Number(p.last_price) || 0;
                    list.innerHTML += `<div class="item-row"><div><h4><a href="${escapeAttr(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer" style="color:white; text-decoration:none;"><i class="fas fa-external-link-alt" style="font-size:0.7rem; color:var(--secondary); margin-right:4px;"></i> ${escapeHtml(p.item_name)}</a></h4><p>${numericPrice.toLocaleString()} UZS</p></div><button class="btn btn-ghost" style="width:auto; padding:4px 8px; color:var(--danger);" onclick="deletePrice(${Number(p.id)})">âŒ</button></div>`;
                });
            }
        }

        async function searchMarketplaceProducts() {
            const query = document.getElementById('search-product-query').value.trim();
            if (!query) {
                showToast('Qidirish uchun kalit so\'z yozing', 'error');
                return;
            }
            const btn = document.getElementById('btn-search-product');
            const originalBtn = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            const list = document.getElementById('search-results-list');
            list.style.display = 'block';
            list.innerHTML = '<div style="text-align:center; padding:10px; color:var(--secondary);"><i class="fas fa-spinner fa-spin"></i> Eng arzon narxlar qidirilmoqda...</div>';

            try {
                const res = await apiFetch(`/api/tracker/cheapest?q=${encodeURIComponent(query)}`, { headers: { 'x-bot-token': token } });
                if (!res.ok) throw new Error('Qidiruv muvaffaqiyatsiz');
                const payload = await res.json();
                const data = Array.isArray(payload.bySource) ? payload.bySource : [];
                list.innerHTML = '';
                if (payload.cheapest) {
                    const best = payload.cheapest;
                    list.innerHTML += `
                        <div class="cheapest-hero">
                            <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
                                <div style="min-width:0;">
                                    <p style="font-size:0.72rem;color:var(--success);font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Eng arzon topildi</p>
                                    <h4 style="margin:6px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                                        <a href="${escapeAttr(safeUrl(best.url))}" target="_blank" rel="noopener noreferrer" style="color:white;text-decoration:none;">${escapeHtml(best.title)}</a>
                                    </h4>
                                    <p style="color:var(--success);font-weight:800;">${best.price.toLocaleString()} UZS <span style="color:var(--secondary);font-weight:500;">${escapeHtml(best.source)}</span></p>
                                </div>
                                <button class="btn btn-primary" style="width:auto; padding:8px 12px; font-size:0.78rem;" onclick="trackSearchProduct('${safeUrl(best.url)}', '${escapeJsString(best.title)}', ${Number(best.price) || 0}, this)"><i class="fas fa-bell"></i></button>
                            </div>
                        </div>`;
                }
                if (data.length > 0) {
                    data.forEach(p => {
                        list.innerHTML += `
                            <div class="item-row" style="margin-bottom: 6px; padding: 8px 12px; background: rgba(255,255,255,0.01);">
                                <div style="flex: 1; min-width: 0; padding-right: 10px;">
                                    <h4 style="font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                                        <a href="${escapeAttr(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer" style="color:var(--accent); text-decoration:none;"><i class="fas fa-external-link-alt" style="font-size:0.75rem;"></i> ${escapeHtml(p.title)}</a>
                                    </h4>
                                    <p style="font-size:0.75rem; color:var(--success); font-weight:600;">${(Number(p.price) || 0).toLocaleString()} UZS <span style="color:var(--secondary); font-weight:normal; font-size:0.65rem;">(${escapeHtml(p.source)})</span></p>
                                </div>
                                <button class="btn btn-primary" style="width:auto; padding:6px 12px; font-size:0.75rem;" onclick="trackSearchProduct('${safeUrl(p.url)}', '${escapeJsString(p.title)}', ${Number(p.price) || 0}, this)"><i class="fas fa-bell"></i> Kuzatish</button>
                            </div>
                        `;
                    });
                } else {
                    list.innerHTML = '<div style="text-align:center; padding:10px; color:var(--secondary);">Hech qanday mahsulot topilmadi.</div>';
                }
            } catch (e) {
                list.innerHTML = `<div style="text-align:center; padding:10px; color:var(--danger);">Xatolik: ${escapeHtml(e.message)}</div>`;
                showToast('Xatolik: ' + e.message, 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalBtn;
            }
        }

        async function trackSearchProduct(url, name, price, btnEl) {
            const originalBtn = btnEl.innerHTML;
            btnEl.disabled = true;
            btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            try {
                const res = await apiFetch(`/api/prices/${userId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-bot-token': token },
                    body: JSON.stringify({ url, name, price })
                });
                if (res.ok) {
                    btnEl.className = 'btn btn-ghost';
                    btnEl.style.color = 'var(--success)';
                    btnEl.innerHTML = '<i class="fas fa-check"></i> Kuzatilmoqda';
                    fetchTrackedPrices();
                    showToast('Tovar kuzatuvga qo\'shildi!', 'success');
                } else {
                    throw new Error('Kuzatishga qo\'shib bo\'lmadi');
                }
            } catch (e) {
                btnEl.disabled = false;
                btnEl.innerHTML = originalBtn;
                showToast('Xatolik: ' + e.message, 'error');
            }
        }

        async function trackPrice() {
            const url = document.getElementById('track-url').value;
            if (!url) return;
            showToast('Narx tekshirilmoqda...', 'info');
            const res = await apiFetch(`/api/prices/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ url, name: 'Tovar', price: 0 }) });
            if (res.ok) { document.getElementById('track-url').value = ''; fetchTrackedPrices(); }
        }

        async function deletePrice(id) {
            await apiFetch(`/api/prices/${userId}/${id}`, { method: 'DELETE', headers: { 'x-bot-token': token } });
            fetchTrackedPrices();
        }

        async function fetchChannels() {
            const r = await apiFetch(`/api/channels/${userId}`, { headers: { 'x-bot-token': token } });
            const data = await r.json();
            const list = document.getElementById('channels-list');
            list.innerHTML = '';
            if (Array.isArray(data)) {
                data.forEach(c => {
                    list.innerHTML += `<div class="item-row"><div><h4>${escapeHtml(c.name)}</h4><p>${escapeHtml(c.platform)}</p></div><button class="btn btn-ghost" style="width:auto; padding:4px 8px; color:var(--danger);" onclick="deleteChannel(${Number(c.id)})">âŒ</button></div>`;
                });
            }
            // Set initial visibility state for telegram options
            toggleTelegramOptions();
        }


        function toggleTelegramOptions() {
            const p = document.getElementById('channel-platform')?.value;
            const show = p === 'telegram';
            const hint = document.getElementById('telegram-source-hint');
            const opts = document.getElementById('telegram-options');
            if (hint) hint.style.display = show ? 'block' : 'none';
            if (opts) opts.style.display = show ? 'block' : 'none';
        }

        async function deleteChannel(id) {
            if (!confirm('Kanalni o\'chirasizmi?')) return;
            try {
                const res = await apiFetch(`/api/channels/${userId}/${id}`, { method: 'DELETE', headers: { 'x-bot-token': token } });
                const data = await res.json();
                if (res.ok) {
                    showToast('Kanal o\'chirildi', 'success');
                    fetchChannels();
                } else {
                    showToast(data.error || 'Xatolik', 'error');
                }
            } catch (e) {
                showToast('Xatolik: ' + e.message, 'error');
            }
        }

        async function addChannel() {
            const platform = document.getElementById('channel-platform').value;
            const channelId = document.getElementById('channel-id').value;
            const name = document.getElementById('channel-name').value;
            if (!platform || !channelId) return;
            const body = { platform, channelId, name: name || channelId };
            if (platform === 'telegram') {
                body.forward_mode = document.getElementById('channel-forward-mode')?.value || 'copy';
                body.use_ai = document.getElementById('channel-use-ai')?.checked || false;
            }
            const res = await apiFetch('/api/channels/' + userId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await res.json();
            if (res.ok) {
                document.getElementById('channel-id').value = '';
                document.getElementById('channel-name').value = '';
                fetchChannels();
            } else showToast(data.error || 'Xatolik', 'error');
        }

        async function loadTrends(refresh) {
            const list = document.getElementById('trends-list');
            const sum = document.getElementById('trends-summary');
            if (list) list.innerHTML = '<p>Tahlil...</p>';
            const res = await apiFetch('/api/trends/uz' + (refresh ? '?refresh=1' : ''));
            const data = await res.json();
            if (sum) sum.textContent = data.summary || '';
            if (list) {
                list.innerHTML = '';
                (data.topics || []).forEach(t => {
                    list.innerHTML += '<div class="item-row"><div><h4>' + escapeHtml(t.name || t) + '</h4><p>' + escapeHtml(t.note || '') + '</p></div><span style="color:var(--gold);font-weight:bold;">' + escapeHtml(t.score || '') + '</span></div>';
                });
            }
        }

        function previewCompose() {
            const body = document.getElementById('compose-body')?.value || '';
            const title = document.getElementById('compose-title')?.value || '';
            const img = document.getElementById('compose-image')?.value;
            const prev = document.getElementById('compose-preview');
            if (!prev) return;
            prev.innerHTML = '<b>' + escapeHtml(title) + '</b><br><br>' + escapeHtml(body).replace(/\n/g, '<br>') + (img ? '<br><img src="' + escapeAttr(safeUrl(img)) + '" style="max-width:100%;margin-top:10px;border-radius:8px;">' : '');
        }

        async function publishCompose() {
            const text = (document.getElementById('compose-title')?.value ? '<b>' + document.getElementById('compose-title').value + '</b>\n\n' : '') + (document.getElementById('compose-body')?.value || '');
            const imageUrl = document.getElementById('compose-image')?.value || null;
            const res = await apiFetch('/api/posts/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, imageUrl }) });
            const data = await res.json();
            if (res.ok) showToast('Yuborildi: ' + data.sentTo + ' kanal', 'success');
            else showToast(data.error || 'Xatolik', 'error');
        }

        async function generateVoiceNews() {
            const status = document.getElementById('voice-status');
            const title = document.getElementById('voice-title')?.value?.trim() || '';
            const text = document.getElementById('voice-text')?.value?.trim() || '';
            if (!title && !text) {
                showToast('Sarlavha yoki matn kiriting', 'error');
                if (status) status.textContent = 'Sarlavha yoki matn kiriting';
                return;
            }
            if (status) status.textContent = 'Generatsiya...';
            try {
                const res = await apiFetch('/api/ai/voice-news', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
                    title,
                    text,
                    sendToChannel: document.getElementById('voice-to-channel')?.checked
                }) });
                const data = await res.json();
                if (res.ok) {
                    if (status) status.textContent = 'Audio yuborildi';
                    showToast('Audio yuborildi', 'success');
                } else {
                    if (status) status.textContent = data.error || 'Xatolik';
                    showToast(data.error || 'Ovoz generatsiyasi xatosi', 'error');
                }
            } catch (e) {
                if (status) status.textContent = 'Aloqa xatosi';
                showToast('Aloqa xatosi: ' + (e.message || e), 'error');
            }
        }

        async function loadOutputChannels() {
            const res = await apiFetch('/api/output-channels/' + userId);
            const data = await res.json();
            document.getElementById('extra-channels').value = (data.extra || '').replace(/,/g, ', ');
            const list = document.getElementById('output-channels-list');
            if (list) {
                list.innerHTML = (data.all || []).map(ch => '<div class="item-row"><span>' + escapeHtml(ch) + '</span></div>').join('');
            }
        }

        async function saveExtraChannels() {
            const raw = document.getElementById('extra-channels')?.value || '';
            const channels = raw.split(',').map(s => s.trim()).filter(Boolean);
            const res = await apiFetch('/api/output-channels/' + userId, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channels }) });
            if (res.ok) { loadOutputChannels(); showToast('Saqlandi!', 'success'); }
        }

        

        async function fetchReferralInfo() {
            const r = await apiFetch(`/api/referral/${userId}`, { headers: { 'x-bot-token': token } });
            const data = await r.json();
            const info = document.getElementById('referral-info');
            info.innerHTML = `<div class="item-row"><div><h4>Havola</h4><p style="font-size:0.7rem; word-break:break-all;">${escapeHtml(data.refLink)}</p></div></div>
                <div class="item-row"><span>Jami</span><span>${escapeHtml(data.stats.total)}</span></div>
                <div class="item-row"><span>Aktiv</span><span>${escapeHtml(data.stats.active)}</span></div>
                <div class="item-row"><span>Premiumgacha</span><span>${escapeHtml(data.stats.needed)} ta</span></div>`;
        }

        function copyReferralLink() {
            const link = document.querySelector('#referral-info p')?.textContent;
            if (link) { navigator.clipboard.writeText(link); showToast('Havola nusxalandi!', 'success'); }
        }

        async function fetchPremiumStatus() {
            if (!userData || !userData.user) return;
            const u = userData.user;
            const status = document.getElementById('premium-status');
            const plans = document.getElementById('premium-plans');
            const purchaseCard = document.getElementById('premium-purchase-card');
            if (u.is_premium) {
                if (status) status.innerHTML = `<div style="color: var(--gold); font-weight: bold; margin-bottom: 10px;">âœ… ${typeof t==='function'?t('premium_active'):'Premium faol'}</div>`;
            } else {
                if (status) status.innerHTML = `<div style="color: var(--secondary); margin-bottom: 10px;">${typeof t==='function'?t('premium_inactive'):'Premium faol emas'}</div>`;
            }
            if (plans) plans.style.display = 'block';
            if (purchaseCard) purchaseCard.style.display = 'block';
            
            // Fetch detailed info for subpage
            try {
                const res = await apiFetch('/api/premium-info', { headers: { 'x-bot-token': token } });
                if (res.ok) {
                    const data = await res.json();
                    const infoEl = document.getElementById('premium-info');
                    if (infoEl) {
                        let text = '<b>Imtiyozlar:</b><br>';
                        data.benefits.forEach(b => text += 'â€¢ ' + escapeHtml(b) + '<br>');
                        if (data.isActive && data.expiresAt) {
                            text = `<b>Faol:</b> ${escapeHtml(new Date(data.expiresAt).toLocaleDateString())}<br><br>` + text;
                        }
                        infoEl.innerHTML = text;
                    }
                    premiumMonthlyUZS = data.monthlyPrice || 25000;
                    premiumYearlyUZS = data.yearlyPrice || 250000;
                    premiumMonthlyStars = data.starsPrice || 500;
                    premiumYearlyStars = data.starsYearlyPrice || 5000;
                    updatePriceDisplay();
                }
            } catch(e){}
        }

        async function buyPremium(plan) {
            const res = await apiFetch('/api/premium/buy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: selectedPayMethod, plan })
            });
            const data = await res.json();
            if (!res.ok || !data.url) {
                showToast(data.error || 'To\'lovni boshlab bo\'lmadi', 'error');
                return;
            }
            if (selectedPayMethod === 'stars' && tg?.openInvoice) {
                tg.openInvoice(data.url, (status) => {
                    if (status === 'paid') {
                        showToast('Premium faollashtirildi!', 'success');
                        location.reload();
                    }
                });
            } else if (tg?.openLink) {
                tg.openLink(data.url);
            } else {
                window.open(data.url, '_blank');
            }
        }

        async function cancelScheduled(id) {
            await apiFetch(`/api/scheduled/${userId}/${id}`, { method: 'DELETE', headers: { 'x-bot-token': token } });
            const r = await apiFetch(`/api/dashboard-info?userId=${userId}`, { headers: { 'x-bot-token': token } });
            userData = await r.json();
            renderUI();
        }

        async function fetchAdminUsers() {
            setupAdminUserFilters();
            const r = await apiFetch('/api/admin/users', { headers: { 'x-bot-token': token } });
            if (!r.ok) {
                showToast(typeof t === 'function' ? t('common_error') : 'Error', 'error');
                return;
            }
            adminUsersCache = await r.json();
            if (!Array.isArray(adminUsersCache)) adminUsersCache = [];
            renderAdminUsersList(adminUsersCache);
        }

        async function fetchAdminSources() {
            const r = await apiFetch('/api/admin/sources', { headers: { 'x-bot-token': token } });
            const data = await r.json();
            const list = document.getElementById('admin-sources-list');
            list.innerHTML = '';
            if (Array.isArray(data)) {
                data.forEach(s => {
                    list.innerHTML += `<div class="item-row"><div><h4>${escapeHtml(s.name)}</h4><p>User: ${escapeHtml(s.user_id)}</p></div></div>`;
                });
            }
        }

        async function sendBroadcast() {
            const message = document.getElementById('broadcast-message').value;
            if (!message) return;
            const res = await apiFetch('/api/admin/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ message }) });
            if (res.ok) {
                showToast('Broadcast yuborildi!', 'success');
                document.getElementById('broadcast-message').value = '';
            }
        }

        async function saveAdminSettings() {
            const starsPrice = document.getElementById('admin-stars-price').value;
            const monthlyPrice = document.getElementById('admin-monthly-price')?.value;
            const yearlyPrice = document.getElementById('admin-yearly-price')?.value;
            const res = await apiFetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ premium_stars_price: starsPrice, price_monthly: monthlyPrice, price_yearly: yearlyPrice }) });
            if (res.ok) showToast('Sozlamalar saqlandi!', 'success');
        }

        async function fetchAdminSettings() {
            const res = await apiFetch('/api/admin/settings', { headers: { 'x-bot-token': token } });
            if (res.ok) {
                const data = await res.json();
                const starsInput = document.getElementById('admin-stars-price');
                const monthlyInput = document.getElementById('admin-monthly-price');
                const yearlyInput = document.getElementById('admin-yearly-price');
                if (starsInput) starsInput.value = data.premium_stars_price || '';
                if (monthlyInput) monthlyInput.value = data.price_monthly || '';
                if (yearlyInput) yearlyInput.value = data.price_yearly || '';
            }
        }

        async function changeUserRole(telegramId) {
            const newRole = prompt(typeof t === 'function' ? t('admin_role_prompt') : 'New role (user, admin, premium):');
            if (!newRole) return;
            const res = await apiFetch(`/api/admin/users/${telegramId}/role`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ role: newRole }) });
            if (res.ok) fetchAdminUsers();
        }

        async function fetchAdminTickets() {
            const r = await apiFetch('/api/tickets/all', { headers: { 'x-bot-token': token } });
            const data = await r.json();
            const list = document.getElementById('admin-tickets-list');
            list.innerHTML = '';
            if (Array.isArray(data)) {
                data.forEach(t => {
                    list.innerHTML += `<div class="item-row"><div><h4>${escapeHtml(t.subject)}</h4><p>${escapeHtml(t.status)} | User: ${escapeHtml(t.user_id)}</p></div></div>`;
                });
            }
        }

        function logout() { localStorage.clear(); location.reload(); }

        // Add Enter key listener for music search
        document.addEventListener('DOMContentLoaded', () => {
            const musicInput = document.getElementById('music-q');
            if (musicInput) {
                musicInput.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        searchMusic();
                    }
                });
            }
        });
    
