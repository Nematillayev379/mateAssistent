const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// 1. renderUI changes
// Hide profile tab for owner, show for others
html = html.replace(
  `// Owner only: show profile tab, navigation already set
                 if (u.role === 'owner') {
                     const navProfile = document.getElementById('nav-profile');
                     if (navProfile) navProfile.style.display = 'flex';
                 }`,
  `// Owner: hide profile tab, use admin tab instead
                 if (u.role === 'owner') {
                     const navProfile = document.getElementById('nav-profile');
                     if (navProfile) navProfile.style.display = 'none';
                 }`
);

// Add premium-active class
html = html.replace(
  `if (u.is_premium) document.getElementById('user-premium-badge').style.display = 'flex';`,
  `if (u.is_premium) {
                 document.documentElement.classList.add('premium-active');
                 const badge = document.getElementById('user-premium-badge');
                 if (badge) badge.style.display = 'flex';
             } else {
                 document.documentElement.classList.remove('premium-active');
             }`
);

// 2. Fix user-info injection in renderUI
html = html.replace(
  /const homePage = document.getElementById\('page-home'\);\s*if \(!document.getElementById\('user-info'\)\) \{\s*homePage.insertBefore\(userInfo, homePage.firstChild\);\s*\}/,
  `const profileInfoContainer = document.getElementById('user-info-content');
            if (profileInfoContainer) {
                profileInfoContainer.innerHTML = userInfo.innerHTML;
            }`
);

// 3. Admin pages "Orqaga" button
html = html.replace(
  /<button class="btn btn-ghost" onclick="showPage\('admin-users'\)" data-i18n="admin_back">Orqaga<\/button>/g,
  `<button class="btn btn-ghost" onclick="showPage('admin')" data-i18n="admin_back">Orqaga</button>`
);
html = html.replace(
  /<button class="btn btn-ghost" onclick="showPage\('admin-sources'\)" data-i18n="admin_back">Orqaga<\/button>/g,
  `<button class="btn btn-ghost" onclick="showPage('admin')" data-i18n="admin_back">Orqaga</button>`
);
html = html.replace(
  /<button class="btn btn-ghost" onclick="showPage\('admin-broadcast'\)" data-i18n="admin_back">Orqaga<\/button>/g,
  `<button class="btn btn-ghost" onclick="showPage('admin')" data-i18n="admin_back">Orqaga</button>`
);
html = html.replace(
  /<button class="btn btn-ghost" onclick="showPage\('admin-settings'\)" data-i18n="admin_back">Orqaga<\/button>/g,
  `<button class="btn btn-ghost" onclick="showPage('admin')" data-i18n="admin_back">Orqaga</button>`
);
html = html.replace(
  /<button class="btn btn-ghost" onclick="showPage\('admin-tickets'\)" data-i18n="admin_back">Orqaga<\/button>/g,
  `<button class="btn btn-ghost" onclick="showPage('admin')" data-i18n="admin_back">Orqaga</button>`
);

// Also we need to make sure admin tab click goes to 'admin' not 'admin-users'
html = html.replace(
  /adminNavItem.onclick = \(\) => showPage\('admin-users'\);/g,
  `adminNavItem.onclick = () => showPage('admin');`
);

// 4. Update fetchPremiumStatus to fetch /api/premium-info and display it in subpage-premium
html = html.replace(
  /async function fetchPremiumStatus\(\) \{[\s\S]*?\}/,
  `async function fetchPremiumStatus() {
            const u = userData.user || {};
            const status = document.getElementById('premium-status');
            const plans = document.getElementById('premium-plans');
            if (u.is_premium) {
                if (status) status.innerHTML = \`<div style="color: var(--gold); font-weight: bold; margin-bottom: 10px;">✅ \${typeof t==='function'?t('premium_active'):'Premium faol'}</div>\`;
                if (plans) plans.style.display = 'none';
            } else {
                if (status) status.innerHTML = \`<div style="color: var(--secondary); margin-bottom: 10px;">\${typeof t==='function'?t('premium_inactive'):'Premium faol emas'}</div>\`;
                if (plans) plans.style.display = 'block';
            }
            
            // Fetch detailed info for subpage
            try {
                const res = await apiFetch('/api/premium-info', { headers: { 'x-bot-token': token } });
                if (res.ok) {
                    const data = await res.json();
                    const infoEl = document.getElementById('premium-info');
                    if (infoEl) {
                        let text = '<b>Imtiyozlar:</b><br>';
                        data.benefits.forEach(b => text += '• ' + b + '<br>');
                        if (data.isActive && data.expiresAt) {
                            text = \`<b>Faol:</b> \${new Date(data.expiresAt).toLocaleDateString()}<br><br>\` + text;
                        }
                        infoEl.innerHTML = text;
                    }
                    const pm = document.getElementById('price-monthly');
                    const py = document.getElementById('price-yearly');
                    if (pm) pm.textContent = data.monthlyPrice + ' UZS';
                    if (py) py.textContent = data.yearlyPrice + ' UZS';
                }
            } catch(e){}
        }`
);

fs.writeFileSync('public/index.html', html, 'utf8');
console.log('JS logic successfully updated.');
