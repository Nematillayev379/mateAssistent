(function () {
  if (typeof window.apiFetch !== 'function') {
    console.error('dashboard-api.js not loaded or apiFetch unavailable');
    return;
  }
  var userId = window.__userId;
  if (!userId) {
    console.warn('dashboard-data-loader: no userId, skipping data load');
    return;
  }

  function el(c) { var e = document.querySelector(c); return e; }
  function setText(c, v) { var e = el(c); if (e) e.textContent = v != null ? v : ''; }

  var page = document.body && document.body.getAttribute('data-page');

  apiFetch('/api/dashboard-info').then(function (r) { return r.json(); }).then(function (d) {
    var u = d.user, s = d.stats || {};
    if (u) {
      setText('.sidebar-user-name', u.first_name || u.username || 'User');
      setText('.sidebar-user-role', u.role === 'owner' ? 'Owner' : u.role === 'admin' ? 'Admin' : 'User');
      setText('.mobile-channel-name', u.target_channel || '@yourchannel');
      setText('.page-user-name', u.first_name || u.username);
    }
    setText('.stat-total-posts', s.total_posts != null ? s.total_posts.toLocaleString() : '0');
    setText('.stat-total-duplicates', s.total_duplicates != null ? s.total_duplicates.toLocaleString() : '0');

    /* --- Sources page --- */
    if (page === 'sources') {
      apiFetch('/api/sources/' + userId).then(function (r) { return r.json(); }).then(function (list) {
        if (!list || !list.length) return;
        var tbody = el('.sources-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        list.forEach(function (src) {
          var tr = document.createElement('tr');
          tr.className = 'border-b border-outline-variant';
          tr.innerHTML = '<td class="py-3 px-2">' + (src.name || 'Unnamed') + '</td>' +
            '<td class="py-3 px-2 text-on-surface-variant text-sm truncate max-w-[200px]">' + (src.url || '') + '</td>' +
            '<td class="py-3 px-2"><span class="px-2 py-0.5 rounded-full text-[10px] ' +
            (src.is_active !== 0 ? 'bg-secondary-container/10 text-secondary' : 'bg-surface-container-high text-on-surface-variant') +
            '">' + (src.is_active !== 0 ? 'Active' : 'Inactive') + '</span></td>' +
            '<td class="py-3 px-2 text-on-surface-variant text-sm">' + (src.lang || 'uz') + '</td>';
          tbody.appendChild(tr);
        });
      }).catch(function () {});
    }

    /* --- Settings page --- */
    if (page === 'settings') {
      apiFetch('/api/settings/' + userId + '/extended').then(function (r) { return r.json(); }).then(function (st) {
        if (!st) return;
        setText('.setting-interval', st.interval_minutes || '15');
        setText('.setting-keywords', st.keywords || '—');
        setText('.setting-digest-time', st.digest_time || '09:00');
        setText('.setting-language', st.language || 'uz');
        if (st.digest_enabled !== undefined) {
          var tog = el('.setting-digest-toggle');
          if (tog) tog.textContent = st.digest_enabled ? "Yoqilgan" : "O'chirilgan";
        }
      }).catch(function () {});
    }

    /* --- Admin users page --- */
    if (page === 'admin-users') {
      apiFetch('/api/admin/users').then(function (r) { return r.json(); }).then(function (list) {
        if (!list || !list.length) return;
        var tbody = el('.admin-users-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        list.forEach(function (usr) {
          var tr = document.createElement('tr');
          tr.className = 'border-b border-outline-variant';
          var status = usr.is_active !== 0 ? 'Active' : 'Inactive';
          var approved = usr.is_approved ? 'Yes' : 'No';
          var premium = usr.is_premium ? 'Premium' : 'Free';
          tr.innerHTML = '<td class="py-3 px-2">' + (usr.telegram_id || '') + '</td>' +
            '<td class="py-3 px-2">' + (usr.first_name || usr.username || '—') + '</td>' +
            '<td class="py-3 px-2"><span class="px-2 py-0.5 rounded-full text-[10px] bg-secondary-container/10 text-secondary">' + status + '</span></td>' +
            '<td class="py-3 px-2">' + approved + '</td>' +
            '<td class="py-3 px-2 font-bold">' + premium + '</td>';
          tbody.appendChild(tr);
        });
      }).catch(function () {});
    }

    /* --- Admin system page --- */
    if (page === 'admin-system') {
      apiFetch('/api/admin/system').then(function (r) { return r.json(); }).then(function (sys) {
        if (!sys) return;
        setText('.sys-uptime', sys.uptime || '—');
        setText('.sys-version', sys.version || '—');
        setText('.sys-users', sys.user_count != null ? sys.user_count : '—');
        setText('.sys-sources', sys.source_count != null ? sys.source_count : '—');
        setText('.sys-posts', sys.post_count != null ? sys.post_count : '—');
        setText('.sys-memory', sys.memory_usage || '—');
      }).catch(function () {});
    }

    /* --- Sources count in stats cards --- */
    if (u && (page === 'overview' || !page)) {
      apiFetch('/api/sources/' + u.id).then(function (r) { return r.json(); }).then(function (srcs) {
        var c = srcs && srcs.length ? srcs.length : 0;
        setText('.stat-active-sources', c);
        setText('.mobile-sources', c);
      }).catch(function () {});
    }
  }).catch(function (e) {
    console.error('Dashboard data error:', e);
    var pageTitle = document.querySelector('h1, h2, .font-display');
    if (pageTitle) {
      var errEl = document.createElement('p');
      errEl.style.cssText = 'color:var(--error,#ffb4ab);text-align:center;padding:16px;font-size:14px;';
      errEl.textContent = 'Ma\'lumotlarni yuklashda xatolik. Iltimos, qayta urinib ko\'ring.';
      pageTitle.parentNode.insertBefore(errEl, pageTitle.nextSibling);
    }
  });

  /* --- Studio drafts --- */
  if (page === 'studio') {
    apiFetch('/api/posts/drafts/' + userId).then(function (r) { return r.json(); }).then(function (list) {
      if (!list || !list.length) return;
      var container = el('.drafts-list');
      if (!container) return;
      container.innerHTML = '';
      list.forEach(function (p) {
        var div = document.createElement('div');
        div.className = 'bg-[#111113] border border-[#1E1E22] rounded-xl p-stack-md';
        div.innerHTML = '<p class="font-body-md font-bold">' + (p.title || 'Untitled') + '</p>' +
          '<p class="text-on-surface-variant text-sm mt-1">' + (p.content ? p.content.substring(0, 100) : '') + '</p>' +
          '<p class="text-[10px] text-on-surface-variant mt-2">' + (p.created_at ? new Date(p.created_at).toLocaleDateString() : '') + '</p>';
        container.appendChild(div);
      });
    }).catch(function () {});
  }

  /* --- Distribution channels --- */
  if (page === 'distribution') {
    apiFetch('/api/channels/' + userId).then(function (r) { return r.json(); }).then(function (list) {
      if (!list || !list.length) return;
      var container = el('.channels-list');
      if (!container) return;
      container.innerHTML = '';
      list.forEach(function (ch) {
        var div = document.createElement('div');
        div.className = 'bg-[#111113] border border-[#1E1E22] rounded-xl p-stack-md flex justify-between items-center';
        div.innerHTML = '<div><p class="font-body-md font-bold">' + (ch.channel_username || ch.channel_id || '—') + '</p>' +
          '<p class="text-on-surface-variant text-sm">' + (ch.is_active ? 'Active' : 'Inactive') + '</p></div>' +
          '<span class="material-symbols-outlined text-on-surface-variant">chevron_right</span>';
        container.appendChild(div);
      });
    }).catch(function () {});
    apiFetch('/api/workspaces/' + userId).then(function (r) { return r.json(); }).then(function (list) {
      if (!list || !list.length) return;
      var container = el('.workspaces-list');
      if (!container) return;
      container.innerHTML = '';
      list.forEach(function (w) {
        var div = document.createElement('div');
        div.className = 'bg-[#111113] border border-[#1E1E22] rounded-xl p-stack-md';
        div.innerHTML = '<p class="font-body-md font-bold">' + (w.name || 'Workspace') + '</p>' +
          '<p class="text-on-surface-variant text-sm">' + (w.channels || []).length + ' channels</p>';
        container.appendChild(div);
      });
    }).catch(function () {});
  }

  /* --- Wallet / Premium --- */
  if (page === 'wallet') {
    apiFetch('/api/premium-info').then(function (r) { return r.json(); }).then(function (info) {
      if (!info) return;
      setText('.wallet-status', info.is_premium ? 'Premium Active' : 'Free');
      setText('.wallet-plan', info.plan || '—');
      setText('.wallet-expiry', info.premium_until ? new Date(info.premium_until).toLocaleDateString() : '—');
    }).catch(function () {});
  }

  /* --- Admin overview / system --- */
  if (page === 'admin-overview') {
    apiFetch('/api/admin/system').then(function (r) { return r.json(); }).then(function (sys) {
      if (!sys) return;
      setText('.admin-stat-users', sys.user_count != null ? sys.user_count : '—');
      setText('.admin-stat-sources', sys.source_count != null ? sys.source_count : '—');
      setText('.admin-stat-posts', sys.post_count != null ? sys.post_count : '—');
    }).catch(function () {});
  }
})();
