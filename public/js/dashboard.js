
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

        function allFields(id) {
            return Array.from(document.querySelectorAll(`[id="${id}"]`));
        }

        function isVisibleField(el) {
            return !!el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0);
        }

        function getFieldValue(id, fallback = '') {
            const fields = allFields(id);
            if (!fields.length) return fallback;
            const visibleField = fields.find(isVisibleField) || fields[0];
            if ('value' in visibleField) return visibleField.value;
            return visibleField.textContent ?? fallback;
        }

        function setFieldValue(id, value) {
            allFields(id).forEach((field) => {
                if ('value' in field) field.value = value;
                else field.textContent = value;
            });
        }

        function setFieldChecked(id, checked) {
            allFields(id).forEach((field) => {
                if ('checked' in field) field.checked = checked;
            });
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
            const quickLang = document.getElementById('quick-lang')?.value || window.__userLang || userData?.user?.language || 'uz';
            window.__userLang = quickLang;
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
                ['#music-search-btn', tt('search_button', 'Search')],
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

        let languageSyncInFlight = false;
        async function syncWebLanguageFromServer(force = false) {
            if (!userId || !token || languageSyncInFlight) return;
            const currentLang = document.getElementById('quick-lang')?.value || (window.WebAppI18n?.getLang?.() || userData?.user?.language || 'uz');
            languageSyncInFlight = true;
            try {
                const res = await apiFetch(`/api/settings/${userId}/extended`, { headers: { 'x-bot-token': token } });
                if (!res.ok) return;
                const data = await res.json();
                const serverLang = data.language || 'uz';
                if (force || (serverLang && serverLang !== currentLang)) {
                    setFieldValue('set-lang', serverLang);
                    setFieldValue('quick-lang', serverLang);
                    setFieldValue('post-lang', serverLang);
                    window.__userLang = serverLang;
                    if (window.WebAppI18n) {
                        WebAppI18n.setLang(serverLang);
                        WebAppI18n.apply(document);
                    }
                    if (userData?.user) userData.user.language = serverLang;
                    applyLocalizedUi();
                }
            } catch (_) {
                // silent sync fallback
            } finally {
                languageSyncInFlight = false;
            }
        }

        function updateWalletUi(account) {
            const stateEl = document.getElementById('wallet-connection-state');
            const addressEl = document.getElementById('wallet-address');
            if (account && account.address) {
                const shortAddress = `${account.address.slice(0, 8)}...${account.address.slice(-6)}`;
                if (stateEl) stateEl.textContent = `${tt('wallet_connected', 'Connected')}: ${shortAddress}`;
                if (addressEl) addressEl.textContent = account.address;
            } else {
                if (stateEl) stateEl.textContent = tt('wallet_not_connected');
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
                    if (wallet?.account?.address) {
                        fetch('/api/premium/wallet-claim', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'x-bot-token': token, 'x-user-id': userId },
                            body: JSON.stringify({ walletAddress: wallet.account.address })
                        }).then(r => r.json()).then(d => {
                            if (d.success) showToast(d.message, 'success');
                        }).catch(() => {});
                    }
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
                if (!res.ok) throw new Error(tt('auth_fail', 'Authentication failed'));
                return res.json();
            }).then(data => {
                token = data.token;
                userId = String(data.userId);
                localStorage.setItem('bot_token', token);
                localStorage.setItem('bot_user_id', userId);
                login(token);
            }).catch(() => {
                document.getElementById('auth-status').textContent = tt('auth_error', 'Login error. Enter your key.');
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
                document.getElementById('auth-status').textContent = tt('auth_welcome', 'Welcome to Admin Panel!');
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
                if (!res.ok) throw new Error(tt('auth_key_invalid', 'Invalid key.'));
                userData = await res.json();
                token = key;
                localStorage.setItem('bot_token', token);
                if (userId) localStorage.setItem('bot_user_id', userId);
                renderUI();
                document.getElementById('auth-screen').style.display = 'none';
                document.getElementById('app').style.display = 'block';
                showPage('overview');
            } catch(e) { showToast(tt('common_error', 'An error occurred') + ': ' + e.message, 'error'); localStorage.removeItem('bot_token'); }
        }

        function isAdminUser(u) {
            return u && (u.role === 'owner' || u.role === 'admin' || u.is_owner);
        }

        async function changeQuickLanguage(language) {
            setFieldValue('set-lang', language);
            setFieldValue('quick-lang', language);
            setFieldValue('post-lang', language);
            window.__userLang = language;
            if (window.WebAppI18n) WebAppI18n.setLang(language);
            if (window.WebAppI18n) WebAppI18n.apply(document);
            applyLocalizedUi();
            if (userData?.user) userData.user.language = language;
            if (userData) renderUI();
            if (document.getElementById('premium-info')) fetchPremiumStatus();
            if (document.getElementById('pay-methods-container')) loadPaymentMethods();
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
                const res = await apiFetch('/api/payments/methods', { headers: { 'x-bot-token': token, 'x-user-id': userId || '' } });
                const methods = res.ok ? await res.json() : { stars: true };
                const defs = [
                    { id: 'stars', key: 'pay_stars', label: tt('pay_stars', '\u2B50 Stars') },
                    { id: 'usdt', key: 'pay_usdt', label: tt('pay_usdt', 'USDT (TRC-20)') },
                    { id: 'ton', key: 'pay_ton', label: tt('pay_ton', 'TON') },
                ];
                container.innerHTML = '';
                defs.forEach((d) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn btn-ghost pay-method-btn' + (selectedPayMethod === d.id ? ' active' : '');
                    btn.dataset.method = d.id;
                    btn.style.cssText = 'width:auto;padding:8px 12px;font-size:0.8rem;';
                    const isConfigured = methods[d.id];
                    btn.textContent = d.label + (!isConfigured ? ' (' + tt('pay_not_set', 'Not set') + ')' : '');
                    btn.onclick = () => setPayMethod(d.id);
                    container.appendChild(btn);
                });
            } catch (_) {
                container.innerHTML = `
                    <button type="button" class="btn btn-ghost pay-method-btn active" data-method="stars" onclick="setPayMethod('stars')">${tt('pay_stars', '\u2B50 Stars')}</button>
                    <button type="button" class="btn btn-ghost pay-method-btn" data-method="usdt" onclick="setPayMethod('usdt')">${tt('pay_usdt', 'USDT (TRC-20)')} (${tt('pay_not_set', 'Not set')})</button>
                    <button type="button" class="btn btn-ghost pay-method-btn" data-method="ton" onclick="setPayMethod('ton')">${tt('pay_ton', 'TON')} (${tt('pay_not_set', 'Not set')})</button>
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
            // BUG-3XX Fix: days=0 -> revoke premium via existing revokePremium endpoint
            const body = (action === 'premium' || action === 'revoke')
              ? JSON.stringify({ days: action === 'revoke' ? 0 : 30 })
              : undefined;
            const res = await apiFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body });
            if (res.ok) {
                showToast(
                  typeof t === 'function'
                    ? (action === 'revoke' ? tt('admin_premium_revoked', 'Premium revoked') : tt('admin_premium_ok', 'Premium granted'))
                    : (action === 'revoke' ? 'Premium revoked' : 'OK'),
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

        var _studioStubs = ['searchMusic','downloadM','downloadAndSendMusic','downloadMusic','sendMusic','downloadMedia','generateAIPost','generateVoiceNews','copyAIPostText','sendAIPostToChannel'];
        _studioStubs.forEach(function(fn) { window[fn] = function() { showToast(tt('studio_loading', 'Studio loading...'), 'info'); }; });

        let studioLoaded = false;
        function loadStudioScript() {
            if (studioLoaded) return;
            studioLoaded = true;
            var s = document.createElement('script');
            s.src = '/js/dashboard-studio.js';
            s.onload = function() { document.dispatchEvent(new Event('studio-ready')); };
            document.head.appendChild(s);
        }
        loadStudioScript();

        function renderUI() {
             const u = userData.user || {};
             const displayName = u.username || u.first_name || u.telegram_id || u.id || 'User';
             const roleLabel = u.role === 'owner' ? ' \uD83D\uDC51 Owner' : (u.role === 'admin' ? ' \uD83D\uDEE1\uFE0F Admin' : '');
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
            
            setFieldValue('set-channel', u.target_channel || '');
            const primaryChannelDisplay = document.getElementById('primary-target-channel-display');
            if (primaryChannelDisplay) primaryChannelDisplay.textContent = u.target_channel || tt('not_set', 'Sozlanmagan');
            setFieldValue('set-lang', u.language || 'uz');
            setFieldValue('quick-lang', u.language || 'uz');
            setFieldValue('post-lang', u.language || 'uz');
            const walletState = document.getElementById('wallet-membership-state');
            if (walletState) walletState.textContent = u.is_premium ? tt('elite', 'ELITE') : tt('free', 'Free');

            const homeTarget = document.getElementById('home-target-channel');
            if (homeTarget) homeTarget.textContent = u.target_channel || (tt('not_set', 'Sozlanmagan') + ' \u26A0\uFE0F');
            setFieldChecked('bot-active-toggle', u.is_active !== 0 && u.is_active !== false);

            // UI-5 Fix: Display full user info - connected RSS and channel
            const userInfo = document.getElementById('user-info') || document.createElement('div');
            userInfo.id = 'user-info';
            userInfo.style.cssText = 'background: rgba(255,255,255,0.03); padding: 15px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 16px;';
            userInfo.innerHTML = `
                <div style="font-size: 0.85rem; color: var(--secondary); margin-bottom: 8px;">${tt('home_user_info', 'Identity Snapshot')}</div>
                <div class="item-row"><span>${tt('home_telegram_id', 'Telegram ID')}</span><span>${escapeHtml(u.telegram_id || tt('unknown', 'Noma\'lum'))}</span></div>
                <div class="item-row"><span>${tt('home_username', 'Username')}</span><span>${escapeHtml(u.username || tt('unknown', 'Noma\'lum'))}</span></div>
                <div class="item-row"><span>${tt('home_target')}</span><span>${escapeHtml(u.target_channel || tt('not_set'))}</span></div>
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
                    sch.innerHTML += `<div class="item-row"><div><h4>${p.type.toUpperCase()}</h4><p>${new Date(p.scheduled_at).toLocaleTimeString()}</p></div><button class="btn btn-ghost" style="width:auto; padding:4px 8px; color:var(--danger);" onclick="cancelScheduled(${p.id})">\u274C</button></div>`;
                });
            } else sch.innerHTML = `<p style="color:var(--secondary); font-size:0.8rem">${tt('home_no_scheduled', 'Navbatda postlar yo\'q.')}</p>`;

            fetchSources();
            loadWorkspaces();
            loadAffiliateInfo();
            if (window.WebAppI18n) {
                WebAppI18n.init(u.language || localStorage.getItem('webapp_lang') || 'uz');
                WebAppI18n.apply(document);
            }
            window.__userLang = u.language || localStorage.getItem('webapp_lang') || 'uz';
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
                            <span>\uD83D\uDFE2 ${escapeHtml(s.name)}</span>
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

        async function loadFinance() {
            const res = await apiFetch('/api/finance/prices', { headers: { 'x-bot-token': token } });
            const data = await res.json();
            document.getElementById('f-btc').textContent = '$' + data.btc;
            document.getElementById('f-usd').textContent = data.usd + ' so\'m';
        }

        async function saveSettings() {
            const language = getFieldValue('set-lang', 'uz');
            const target_channel = getFieldValue('set-channel', '');
            const keywords = getFieldValue('set-keywords', '');
            const interval_minutes = Math.max(1, Math.min(1440, parseInt(getFieldValue('set-interval', '15') || '15', 10) || 15));
            const daily_digest = getFieldValue('set-digest', 'false') === 'true';
            const digest_time = getFieldValue('set-digest-time', '20:00') || '20:00';
            const res = await apiFetch(`/api/settings/${userId}/extended`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ language, target_channel, keywords, interval_minutes, daily_digest, digest_time }) });
            if (res.ok) {
                userData.user.language = language;
                userData.user.target_channel = target_channel;
                const primaryChannelDisplay = document.getElementById('primary-target-channel-display');
                if (primaryChannelDisplay) primaryChannelDisplay.textContent = target_channel || tt('not_set', 'Sozlanmagan');
                userData.user.interval_minutes = interval_minutes;
                userData.user.daily_digest = daily_digest;
                userData.user.digest_time = digest_time;
                setFieldValue('set-lang', language);
                setFieldValue('set-channel', target_channel);
                setFieldValue('set-keywords', keywords);
                setFieldValue('set-interval', String(interval_minutes));
                setFieldValue('set-digest', daily_digest ? 'true' : 'false');
                setFieldValue('set-digest-time', digest_time);
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

        async function removeMainChannel() {
            if (!confirm('Asosiy kanalni olib tashlaysizmi?')) return;
            try {
                const res = await apiFetch(`/api/settings/${userId}/extended`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-bot-token': token },
                    body: JSON.stringify({ target_channel: '' })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(data.error || 'Kanalni olib tashlab bo‘lmadi');
                setFieldValue('set-channel', '');
                if (userData?.user) userData.user.target_channel = '';
                const primaryChannelDisplay = document.getElementById('primary-target-channel-display');
                if (primaryChannelDisplay) primaryChannelDisplay.textContent = tt('not_set', 'Sozlanmagan');
                renderUI();
                showToast(tt('channel_removed', 'Channel removed'), 'success');
            } catch (e) {
                showToast(tt('common_error', 'An error occurred') + ': ' + e.message, 'error');
            }
        }

        async function toggleBotActive(checked) {
            try {
                const res = await apiFetch(`/api/settings/${userId}/toggle`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'x-bot-token': token }
                });
                if (!res.ok) throw new Error(tt('bot_status_update_failed', 'Could not update bot status.'));
                const data = await res.json().catch(() => ({}));
                const active = data.is_active !== 0 && data.is_active !== false;
                userData.user.is_active = active;
                setFieldChecked('bot-active-toggle', active);
                showToast(active ? tt('bot_status_on', 'Bot enabled') : tt('bot_status_off', 'Bot disabled'), 'success');
                renderUI();
            } catch (e) {
                setFieldChecked('bot-active-toggle', !checked);
                showToast(tt('common_error', 'An error occurred') + ': ' + e.message, 'error');
            }
        }

        async function loadSystemStatus() {
            const res = await apiFetch('/api/admin/system');
            if (!res.ok) {
                showToast(tt('system_status_load_failed', 'Could not load system status.'), 'error');
                return;
            }
            const data = await res.json();
            document.getElementById('sys-uptime').textContent = Math.floor(data.uptime / 3600) + ' soat';
            document.getElementById('sys-redis').textContent = data.redis ? tt('system_online', 'Online') : tt('system_offline', 'Offline');
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
            if (p === 'services' || p === 'studio') loadStudioScript();
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

        window.addEventListener('focus', () => {
            syncWebLanguageFromServer();
        });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) syncWebLanguageFromServer();
        });

        async function fetchExtendedSettings() {
            try {
                const r = await apiFetch(`/api/settings/${userId}/extended`, { headers: { 'x-bot-token': token } });
                if (!r.ok) throw new Error(tt('common_error', 'An error occurred') + ': ' + r.status);
                const data = await r.json();
                setFieldValue('set-lang', data.language || 'uz');
                setFieldValue('quick-lang', data.language || 'uz');
                setFieldValue('set-channel', data.target_channel || '');
                setFieldValue('set-keywords', data.keywords || '');
                setFieldValue('set-interval', String(data.interval_minutes || 15));
                setFieldValue('set-digest', data.daily_digest ? 'true' : 'false');
                setFieldValue('set-digest-time', data.digest_time || '20:00');
                setFieldChecked('bot-active-toggle', data.is_active !== 0 && data.is_active !== false);
                window.__userLang = data.language || window.__userLang || 'uz';
                if (window.WebAppI18n && data.language && data.language !== window.WebAppI18n.getLang()) {
                    WebAppI18n.setLang(data.language);
                    WebAppI18n.apply(document);
                    applyLocalizedUi();
                }
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
                    const safeKey = raw.length > 10 ? `${raw.slice(0, 6)}...${raw.slice(-4)}` : tt('unknown', 'Unknown');
                    return `
                        <div class="item-row" style="align-items:flex-start; gap:12px;">
                            <div style="flex:1;">
                                <h4>${escapeHtml(k.api_type || tt('api_key_type', 'Key'))}</h4>
                                <p style="font-size:0.78rem; color:var(--secondary);">${escapeHtml(safeKey)}</p>
                                <p style="font-size:0.72rem; color:var(--secondary); margin-top:4px;">ID: ${k.id || '-'} | ${k.is_active === false ? tt('key_inactive', 'Inactive') : tt('key_active', 'Active')}</p>
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
            if (confirm(tt('confirm_delete_key', 'Delete this key?'))) {
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
                showToast(err.error || tt('api_key_save_failed', 'Could not save API key.'), 'error');
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
            if (res.ok) { document.getElementById('ticket-subject').value = ''; document.getElementById('ticket-message').value = ''; fetchTickets(); showToast(tt('common_ticket_sent', 'Ticket sent!'), 'success'); }
        }

        async function fetchTrackedPrices() {
            const r = await apiFetch(`/api/prices/${userId}`, { headers: { 'x-bot-token': token } });
            const data = await r.json();
            const list = document.getElementById('tracked-list');
            list.innerHTML = '';
            if (Array.isArray(data)) {
                data.forEach(p => {
                    const numericPrice = Number(p.last_price) || 0;
                    list.innerHTML += `<div class="item-row"><div><h4><a href="${escapeAttr(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer" style="color:white; text-decoration:none;"><i class="fas fa-external-link-alt" style="font-size:0.7rem; color:var(--secondary); margin-right:4px;"></i> ${escapeHtml(p.item_name)}</a></h4><p>${numericPrice.toLocaleString()} UZS</p></div><button class="btn btn-ghost" style="width:auto; padding:4px 8px; color:var(--danger);" onclick="deletePrice(${Number(p.id)})">\u274C</button></div>`;
                });
            }
        }

        async function searchMarketplaceProducts() {
            const query = document.getElementById('search-product-query').value.trim();
            if (!query) {
                showToast(tt('search_query_required', 'Please enter a search term.'), 'error');
                return;
            }
            const btn = document.getElementById('btn-search-product');
            const originalBtn = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

            const list = document.getElementById('search-results-list');
            list.style.display = 'block';
            list.innerHTML = '<div style="text-align:center; padding:10px; color:var(--secondary);"><i class="fas fa-spinner fa-spin"></i> ' + tt('price_search_loading', 'Searching cheapest prices...') + '</div>';

            try {
                const res = await apiFetch(`/api/tracker/cheapest?q=${encodeURIComponent(query)}`, { headers: { 'x-bot-token': token } });
                if (!res.ok) throw new Error(tt('search_failed', 'Search failed.'));
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
                                <button class="btn btn-primary" style="width:auto; padding:6px 12px; font-size:0.75rem;" onclick="trackSearchProduct('${safeUrl(p.url)}', '${escapeJsString(p.title)}', ${Number(p.price) || 0}, this)"><i class="fas fa-bell"></i> ${tt('track_button', 'Track')}</button>
                            </div>
                        `;
                    });
                } else {
                    list.innerHTML = '<div style="text-align:center; padding:10px; color:var(--secondary);">' + tt('no_results', 'No results found.') + '</div>';
                }
            } catch (e) {
                list.innerHTML = `<div style="text-align:center; padding:10px; color:var(--danger);">${tt('common_error', 'An error occurred')}: ${escapeHtml(e.message)}</div>`;
                showToast(tt('common_error', 'An error occurred') + ': ' + e.message, 'error');
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
                    btnEl.innerHTML = '<i class="fas fa-check"></i> ' + tt('tracking_in_progress', 'Tracking...');
                    fetchTrackedPrices();
                    showToast(tt('tracked_item_added', 'Item added to tracking!'), 'success');
                } else {
                    throw new Error(tt('track_add_failed', 'Could not add the item to tracking.'));
                }
            } catch (e) {
                btnEl.disabled = false;
                btnEl.innerHTML = originalBtn;
                showToast(tt('common_error', 'An error occurred') + ': ' + e.message, 'error');
            }
        }

        async function trackPrice() {
            const url = document.getElementById('track-url').value;
            if (!url) return;
            showToast(tt('price_checking', 'Checking price...'), 'info');
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
                    list.innerHTML += `<div class="item-row"><div><h4>${escapeHtml(c.name)}</h4><p>${escapeHtml(c.platform)}</p></div><button class="btn btn-ghost" style="width:auto; padding:4px 8px; color:var(--danger);" onclick="deleteChannel(${Number(c.id)})">\u274C</button></div>`;
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
                    showToast(tt('channel_deleted', 'Channel deleted.'), 'success');
                    fetchChannels();
                } else {
                    showToast(data.error || 'Xatolik', 'error');
                }
            } catch (e) {
                showToast(tt('common_error', 'An error occurred') + ': ' + e.message, 'error');
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
            if (list) list.innerHTML = '<p>' + tt('analysis_loading', 'Analyzing...') + '</p>';
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
            if (res.ok) showToast(tt('sent_to_channels', 'Sent to {count} channels').replace('{count}', data.sentTo), 'success');
            else showToast(data.error || 'Xatolik', 'error');
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
            if (res.ok) { loadOutputChannels(); showToast(tt('workspace_saved', 'Saved!'), 'success'); }
        }

        

        async function fetchReferralInfo() {
            const r = await apiFetch(`/api/referral/${userId}`, { headers: { 'x-bot-token': token } });
            const data = await r.json();
            const info = document.getElementById('referral-info');
            info.innerHTML = `<div class="item-row"><div><h4>${tt('referral_link_label', 'Link')}</h4><p style="font-size:0.7rem; word-break:break-all;">${escapeHtml(data.refLink)}</p></div></div>
                <div class="item-row"><span>${tt('referral_total', 'Total')}</span><span>${escapeHtml(data.stats.total)}</span></div>
                <div class="item-row"><span>${tt('referral_active', 'Active')}</span><span>${escapeHtml(data.stats.active)}</span></div>
                <div class="item-row"><span>${tt('referral_needed', 'To premium')}</span><span>${escapeHtml(data.stats.needed)} ta</span></div>`;
        }

        function copyReferralLink() {
            const link = document.querySelector('#referral-info p')?.textContent;
            if (link) { navigator.clipboard.writeText(link); showToast(tt('common_copied', 'Link copied!'), 'success'); }
        }

        async function loadAffiliateInfo() {
            try {
                const r = await apiFetch('/api/affiliate', { headers: { 'x-bot-token': token } });
                const d = await r.json();
                const el = document.getElementById('affiliate-info');
                if (!el) return;
                if (d.link) {
                    const rewardRule = tt('referral_rule', 'Every {count} active referrals = {days} days Premium')
                        .replace('{count}', escapeHtml(d.rewardPerActive))
                        .replace('{days}', escapeHtml(d.daysPerReward));
                    el.innerHTML = '<div class="item-row"><span>' + tt('referral_total', 'Total') + '</span><span>' + escapeHtml(d.total) + '</span></div>' +
                        '<div class="item-row"><span>' + tt('referral_active', 'Active') + '</span><span>' + escapeHtml(d.active) + '</span></div>' +
                        '<div class="item-row"><span>' + tt('referral_rewards', 'Rewards') + '</span><span>' + escapeHtml(d.premiumCount) + '</span></div>' +
                        '<div style="margin-top:8px;font-size:0.75rem;color:var(--gold);"><b>' + rewardRule + '</b></div>' +
                        '<div style="margin-top:6px;font-size:0.75rem;word-break:break-all;"><code>' + escapeHtml(d.link) + '</code></div>';
                    const refInfo = document.getElementById('referral-info');
                    if (refInfo) {
                        refInfo.innerHTML = '<div class="item-row"><span>' + tt('referral_total', 'Total') + '</span><span>' + escapeHtml(d.total) + '</span></div>' +
                            '<div class="item-row"><span>' + tt('referral_active', 'Active') + '</span><span>' + escapeHtml(d.active) + '</span></div>' +
                            '<div class="item-row"><span>' + tt('referral_needed', 'To premium') + '</span><span>' + escapeHtml(d.needed) + '</span></div>';
                    }
                } else {
                    el.innerHTML = '<p style="color:var(--secondary);">' + (typeof t === 'function' ? t('referral_not_found') : 'Referral kodi topilmadi') + '</p>';
                }
            } catch (e) { showToast(tt('affiliate_load_failed', 'Could not load affiliate data.'), 'error'); }
        }

        async function loadWorkspaces() {
            try {
                const r = await apiFetch('/api/workspaces', { headers: { 'x-bot-token': token } });
                const workspaces = await r.json();
                const el = document.getElementById('workspace-list');
                if (!el) return;
                if (!Array.isArray(workspaces) || workspaces.length === 0) {
                    el.innerHTML = '<p style="color:var(--secondary);font-size:0.85rem;">' + tt('no_workspaces', 'No workspaces yet.') + '</p>';
                    return;
                }
                let html = '';
                for (const ws of workspaces) {
                    const chCount = (ws.channels || []).length;
                    const mCount = (ws.members || []).length;
                    html += '<div style="background:rgba(255,255,255,0.03);padding:10px;border-radius:8px;margin-bottom:8px;font-size:0.85rem;">' +
                        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                        '<b>' + escapeHtml(ws.name) + '</b>' +
                        '<button class="btn btn-ghost" style="padding:2px 8px;font-size:0.75rem;" onclick="deleteWorkspace(' + ws.id + ')"><i class="fas fa-trash"></i></button></div>' +
                        '<div style="color:var(--secondary);margin-top:4px;">' + chCount + ' kanal, ' + mCount + ' a\'zo</div></div>';
                }
                el.innerHTML = html;
            } catch (e) { /* ignore */ }
        }

        async function createWorkspace() {
            const name = document.getElementById('new-workspace-name')?.value?.trim();
            if (!name) { showToast(tt('workspace_name_required', 'Please enter a workspace name.'), 'error'); return; }
            const r = await apiFetch('/api/workspaces', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const d = await r.json();
            if (d.success) { showToast(tt('workspace_created', 'Workspace created!'), 'success'); document.getElementById('new-workspace-name').value = ''; loadWorkspaces(); }
            else { showToast(d.error || 'Xatolik', 'error'); }
        }

        async function deleteWorkspace(id) {
            if (!confirm('Workspace ni o\'chirishni xohlaysizmi?')) return;
            const r = await apiFetch('/api/workspaces/' + id, { method: 'DELETE' });
            if (r.ok) { showToast(tt('workspace_deleted', 'Workspace deleted.'), 'success'); loadWorkspaces(); }
        }

        async function fetchPremiumStatus() {
            if (!userData || !userData.user) return;
            const u = userData.user;
            const status = document.getElementById('premium-status');
            const plans = document.getElementById('premium-plans');
            const purchaseCard = document.getElementById('premium-purchase-card');
            if (u.is_premium) {
                if (status) status.innerHTML = `<div style="color: var(--gold); font-weight: bold; margin-bottom: 10px;">\u2705 ${tt('premium_active', 'Premium active')}</div>`;
            } else {
                if (status) status.innerHTML = `<div style="color: var(--secondary); margin-bottom: 10px;">${tt('premium_inactive', 'Premium inactive')}</div>`;
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
                        let text = `<b>${tt('premium_benefits', 'Benefits')}:</b><br>`;
                        data.benefits.forEach(b => text += '\u2022 ' + escapeHtml(b) + '<br>');
                        if (data.isActive && data.expiresAt) {
                            text = `<b>${tt('premium_active', 'Premium active')}:</b> ${escapeHtml(new Date(data.expiresAt).toLocaleDateString())}<br><br>` + text;
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
            if (selectedPayMethod === 'usdt' || selectedPayMethod === 'ton') {
                const res = await apiFetch('/api/premium/buy', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ method: selectedPayMethod, plan })
                });
                const data = await res.json();
                if (!res.ok || !data.request) {
                    showToast(data.error || 'To\'lovni boshlab bo\'lmadi', 'error');
                    return;
                }
                const req = data.request;
                showCryptoPaymentModal(req);
                return;
            }
            const res = await apiFetch('/api/premium/buy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ method: 'stars', plan })
            });
            const data = await res.json();
            if (!res.ok || !data.url) {
                showToast(data.error || 'To\'lovni boshlab bo\'lmadi', 'error');
                return;
            }
            if (tg?.openInvoice) {
                tg.openInvoice(data.url, (status) => {
                    if (status === 'paid') {
                        showToast(tt('premium_activated', 'Premium activated!'), 'success');
                        location.reload();
                    }
                });
            } else {
                window.open(data.url, '_blank');
            }
        }

        var cryptoPollInterval = null;
        function showCryptoPaymentModal(req) {
            var existing = document.getElementById('crypto-payment-modal');
            if (existing) existing.remove();
            if (cryptoPollInterval) { clearInterval(cryptoPollInterval); cryptoPollInterval = null; }
            var overlay = document.createElement('div');
            overlay.id = 'crypto-payment-modal';
            overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
            const paymentTitle = tt('wallet_payment_title', '{currency} payment').replace('{currency}', escapeHtml(req.currency));
            const walletAddress = escapeHtml(req.walletAddress);
            const walletMemo = escapeHtml(req.memo);
            overlay.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:30px;max-width:400px;width:100%;text-align:center;">' +
                '<h3 style="margin-bottom:16px;">' + paymentTitle + '</h3>' +
                '<p style="color:var(--secondary);margin-bottom:8px;">' + tt('wallet_amount_label', 'Amount to send:') + '</p>' +
                '<div style="font-size:1.8rem;font-weight:700;color:var(--accent);margin-bottom:16px;">' + req.cryptoAmount + ' ' + req.currency + '</div>' +
                '<p style="color:var(--secondary);margin-bottom:4px;">' + tt('wallet_address_label', 'Wallet address:') + '</p>' +
                '<div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:12px;font-size:0.75rem;word-break:break-all;margin-bottom:8px;font-family:monospace;">' + walletAddress + '</div>' +
                '<button class="btn btn-ghost" style="width:auto;padding:4px 12px;font-size:0.75rem;margin-bottom:16px;" onclick="navigator.clipboard.writeText(\'' + escapeJsString(req.walletAddress) + '\').then(function(){showToast(tt(\'common_copied\', \'Link copied!\'),\'success\')})">\u{1F4CB} ' + tt('wallet_copy', 'Copy') + '</button>' +
                '<p style="color:var(--secondary);margin-bottom:4px;">' + tt('wallet_memo_label', 'Memo:') + '</p>' +
                '<div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:8px;font-size:1rem;font-weight:600;margin-bottom:16px;font-family:monospace;">' + walletMemo + '</div>' +
                '<p style="font-size:0.8rem;color:var(--secondary);margin-bottom:20px;">\u26A0\uFE0F ' + tt('wallet_memo_hint', 'Use this memo in the transfer comment!') + '</p>' +
                '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
                '<button class="btn btn-primary" onclick="verifyCryptoPayment(\'' + req.id + '\')" id="crypto-verify-btn">\u2705 ' + tt('wallet_paid', 'I paid') + '</button>' +
                '<button class="btn btn-ghost" onclick="closeCryptoModal()">\u274C ' + tt('wallet_close', 'Close') + '</button>' +
                '</div>' +
                '<div id="crypto-status" style="margin-top:12px;font-size:0.85rem;color:var(--secondary);"></div>' +
                '</div>';
            document.body.appendChild(overlay);
            cryptoPollInterval = setInterval(function() {
                fetch('/api/crypto-payment/status/' + req.id, {
                    method: 'POST',
                    headers: { 'x-bot-token': token, 'x-user-id': userId, 'Content-Type': 'application/json' }
                }).then(function(r){return r.json()}).then(function(d) {
                    if (d.status === 'paid') {
                        showToast(tt('premium_activated', 'Premium activated!'), 'success');
                        closeCryptoModal();
                        location.reload();
                    }
                }).catch(function(){});
            }, 10000);
        }

        async function verifyCryptoPayment(id) {
            var btn = document.getElementById('crypto-verify-btn');
            var statusEl = document.getElementById('crypto-status');
            if (btn) btn.disabled = true;
            if (statusEl) statusEl.textContent = tt('checking', 'Checking...');
            try {
                var r = await fetch('/api/crypto-payment/status/' + id, {
                    method: 'POST',
                    headers: { 'x-bot-token': token, 'x-user-id': userId, 'Content-Type': 'application/json' }
                });
                var d = await r.json();
                if (d.status === 'paid') {
                    showToast(tt('premium_activated', 'Premium activated!'), 'success');
                    closeCryptoModal();
                    location.reload();
                } else if (d.status === 'pending') {
                    if (statusEl) statusEl.textContent = tt('payment_not_found', 'Payment not found. It may take a bit to confirm on-chain. If you already paid, try again shortly.');
                } else {
                    if (statusEl) statusEl.textContent = tt('order_not_found', 'Order not found or expired.');
                }
            } catch(e) {
                if (statusEl) statusEl.textContent = tt('common_error', 'An error occurred') + ': ' + e.message;
            }
            if (btn) btn.disabled = false;
        }

        function closeCryptoModal() {
            var el = document.getElementById('crypto-payment-modal');
            if (el) el.remove();
            if (cryptoPollInterval) { clearInterval(cryptoPollInterval); cryptoPollInterval = null; }
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
                    list.innerHTML += `<div class="item-row"><div><h4>${escapeHtml(s.name)}</h4><p>${tt('user_label', 'User')}: ${escapeHtml(s.user_id)}</p></div></div>`;
                });
            }
        }

        async function sendBroadcast() {
            const message = document.getElementById('broadcast-message').value;
            if (!message) return;
            const res = await apiFetch('/api/admin/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ message }) });
            if (res.ok) {
                showToast(tt('common_broadcast_sent', 'Broadcast queued!'), 'success');
                document.getElementById('broadcast-message').value = '';
            }
        }

        async function saveAdminSettings() {
            const starsPrice = document.getElementById('admin-stars-price').value;
            const monthlyPrice = document.getElementById('admin-monthly-price')?.value;
            const yearlyPrice = document.getElementById('admin-yearly-price')?.value;
            const requireApproval = document.getElementById('admin-require-approval')?.checked;
            const res = await apiFetch('/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ premium_stars_price: starsPrice, price_monthly: monthlyPrice, price_yearly: yearlyPrice, require_approval: requireApproval }) });
            if (res.ok) showToast(tt('common_saved', 'Settings saved!'), 'success');
        }

        async function fetchAdminSettings() {
            const res = await apiFetch('/api/admin/settings', { headers: { 'x-bot-token': token } });
            if (res.ok) {
                const data = await res.json();
                const starsInput = document.getElementById('admin-stars-price');
                const monthlyInput = document.getElementById('admin-monthly-price');
                const yearlyInput = document.getElementById('admin-yearly-price');
                const requireApproval = document.getElementById('admin-require-approval');
                if (starsInput) starsInput.value = data.premium_stars_price || '';
                if (monthlyInput) monthlyInput.value = data.price_monthly || '';
                if (yearlyInput) yearlyInput.value = data.price_yearly || '';
                if (requireApproval) requireApproval.checked = data.require_approval === true;
            }
        }

        async function changeUserRole(telegramId) {
            const newRole = prompt(tt('admin_role_prompt', 'New role (user, admin, premium):'));
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
                    list.innerHTML += `<div class="item-row"><div><h4>${escapeHtml(t.subject)}</h4><p>${escapeHtml(t.status)} | ${tt('user_label', 'User')}: ${escapeHtml(t.user_id)}</p></div></div>`;
                });
            }
        }

        function logout() { localStorage.clear(); location.reload(); }
    
