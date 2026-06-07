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
  function setAllText(c, v) { document.querySelectorAll(c).forEach(function (e) { e.textContent = v != null ? v : ''; }); }
  function setAllValue(id, v) {
    document.querySelectorAll('[id="' + id + '"]').forEach(function (e) {
      if ('value' in e) e.value = v;
      else e.textContent = v;
    });
  }
  function cell(tr, value, cls) {
    var td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = value != null ? String(value) : '';
    tr.appendChild(td);
    return td;
  }
  function safeJson(r) {
    if (!r.ok) return null;
    return r.json().catch(function () { return null; });
  }
  function safeIconValue(raw) {
    var v = String(raw || '').trim();
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(v)) return '';
    return v;
  }

  var page = document.body && document.body.getAttribute('data-page');

  apiFetch('/api/dashboard-info').then(safeJson).then(function (d) {
    if (!d) return;
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
      apiFetch('/api/sources/' + userId).then(safeJson).then(function (list) {
        if (!list || !list.length) return;
        var tbody = el('.sources-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        list.forEach(function (src) {
          var tr = document.createElement('tr');
          tr.className = 'border-b border-outline-variant';
          cell(tr, src.name || 'Unnamed', 'py-3 px-2');
          cell(tr, src.url || '', 'py-3 px-2 text-on-surface-variant text-sm truncate max-w-[200px]');
          var statusTd = document.createElement('td');
          statusTd.className = 'py-3 px-2';
          var badge = document.createElement('span');
          badge.className = 'px-2 py-0.5 rounded-full text-[10px] ' +
            (src.is_active !== 0 ? 'bg-secondary-container/10 text-secondary' : 'bg-surface-container-high text-on-surface-variant');
          badge.textContent = src.is_active !== 0 ? 'Active' : 'Inactive';
          statusTd.appendChild(badge);
          tr.appendChild(statusTd);
          cell(tr, src.lang || 'uz', 'py-3 px-2 text-on-surface-variant text-sm');
          tbody.appendChild(tr);
        });
      }).catch(function () {});
    }

    /* --- Settings page --- */
    if (page === 'settings') {
      apiFetch('/api/settings/' + userId + '/extended').then(safeJson).then(function (st) {
        if (!st) return;
        setAllValue('set-lang', st.language || 'uz');
        setAllValue('set-channel', st.target_channel || '');
        setAllValue('set-keywords', st.keywords || '');
        setAllValue('set-interval', String(st.interval_minutes || 15));
        setAllValue('set-digest', st.daily_digest ? 'true' : 'false');
        setAllValue('set-digest-time', st.digest_time || '09:00');
        setText('.setting-interval', st.interval_minutes || '15');
        setText('.setting-keywords', st.keywords || '—');
        setText('.setting-digest-time', st.digest_time || '09:00');
        setText('.setting-language', st.language || 'uz');
      }).catch(function () {});
    }

    /* --- Admin users page --- */
    if (page === 'admin-users') {
      apiFetch('/api/admin/users').then(safeJson).then(function (list) {
        if (!list || !list.length) return;
        var tbody = el('.admin-users-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        list.forEach(function (usr) {
          var tr = document.createElement('tr');
          tr.className = 'border-b border-outline-variant';
          cell(tr, usr.telegram_id || '', 'py-3 px-2');
          cell(tr, usr.first_name || usr.username || '—', 'py-3 px-2');
          var statusTd = document.createElement('td');
          statusTd.className = 'py-3 px-2';
          var badge = document.createElement('span');
          badge.className = 'px-2 py-0.5 rounded-full text-[10px] bg-secondary-container/10 text-secondary';
          badge.textContent = usr.is_active !== 0 ? 'Active' : 'Inactive';
          statusTd.appendChild(badge);
          tr.appendChild(statusTd);
          cell(tr, usr.is_approved ? 'Yes' : 'No', 'py-3 px-2');
          cell(tr, usr.is_premium ? 'Premium' : 'Free', 'py-3 px-2 font-bold');
          tbody.appendChild(tr);
        });
      }).catch(function () {});
    }

    /* --- Admin system page --- */
    if (page === 'admin-system') {
      apiFetch('/api/admin/system').then(safeJson).then(function (sys) {
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
      apiFetch('/api/sources/' + userId).then(safeJson).then(function (srcs) {
        var c = srcs && srcs.length ? srcs.length : 0;
        setText('.stat-active-sources', c);
        setText('.mobile-sources', c);
      }).catch(function () {});
    }

    /* --- Analytics page --- */
    if (u && page === 'analytics') {
      apiFetch('/api/sources/' + userId).then(safeJson).then(function (srcs) {
        var c = srcs && srcs.length ? srcs.length : 0;
        setText('.analytics-source-total', c + (c >= 100 ? '+' : ''));
      }).catch(function () {});
      var totalPosts = Number(s.total_posts || 0);
      var totalDuplicates = Number(s.total_duplicates || 0);
      var accuracy = totalPosts > 0 ? Math.max(0, Math.min(100, ((totalPosts - totalDuplicates) / totalPosts) * 100)) : 0;
      setText('.analytics-accuracy', accuracy.toFixed(1) + '%');
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
    apiFetch('/api/posts/drafts/' + userId).then(safeJson).then(function (list) {
      if (!list || !list.length) return;
      var container = el('.drafts-list');
      if (!container) return;
      container.innerHTML = '';
      list.forEach(function (p) {
        var div = document.createElement('div');
        div.className = 'bg-[#111113] border border-[#1E1E22] rounded-xl p-stack-md';
        var t1 = document.createElement('p'); t1.className = 'font-body-md font-bold';
        t1.textContent = p.title || 'Untitled'; div.appendChild(t1);
        var t2 = document.createElement('p'); t2.className = 'text-on-surface-variant text-sm mt-1';
        t2.textContent = p.content ? p.content.substring(0, 100) : '';
        div.appendChild(t2);
        var t3 = document.createElement('p'); t3.className = 'text-[10px] text-on-surface-variant mt-2';
        t3.textContent = p.created_at ? new Date(p.created_at).toLocaleDateString() : '';
        div.appendChild(t3);
        container.appendChild(div);
      });
    }).catch(function () {});
  }

  /* --- Distribution channels --- */
  if (page === 'distribution') {
    apiFetch('/api/channels/' + userId).then(safeJson).then(function (list) {
      if (!list || !list.length) return;
      var container = el('.channels-list');
      if (!container) return;
      container.innerHTML = '';
      list.forEach(function (ch) {
        var div = document.createElement('div');
        div.className = 'bg-[#111113] border border-[#1E1E22] rounded-xl p-stack-md flex justify-between items-center';
        var left = document.createElement('div');
        var p1 = document.createElement('p'); p1.className = 'font-body-md font-bold';
        p1.textContent = ch.channel_username || ch.channel_id || '—';
        left.appendChild(p1);
        var p2 = document.createElement('p'); p2.className = 'text-on-surface-variant text-sm';
        p2.textContent = ch.is_active ? 'Active' : 'Inactive';
        left.appendChild(p2);
        div.appendChild(left);
        var icon = document.createElement('span');
        icon.className = 'material-symbols-outlined text-on-surface-variant';
        icon.textContent = safeIconValue('chevron_right') || 'chevron_right';
        div.appendChild(icon);
        container.appendChild(div);
      });
    }).catch(function () {});
    apiFetch('/api/workspaces/' + userId).then(safeJson).then(function (list) {
      if (!list || !list.length) return;
      var container = el('.workspaces-list');
      if (!container) return;
      container.innerHTML = '';
      list.forEach(function (w) {
        var div = document.createElement('div');
        div.className = 'bg-[#111113] border border-[#1E1E22] rounded-xl p-stack-md';
        var p1 = document.createElement('p'); p1.className = 'font-body-md font-bold';
        p1.textContent = w.name || 'Workspace';
        div.appendChild(p1);
        var p2 = document.createElement('p'); p2.className = 'text-on-surface-variant text-sm';
        p2.textContent = ((w.channels || []).length) + ' channels';
        div.appendChild(p2);
        container.appendChild(div);
      });
    }).catch(function () {});
  }

  /* --- Wallet / Premium --- */
  if (page === 'wallet') {
    apiFetch('/api/premium-info').then(safeJson).then(function (info) {
      if (!info) return;
      var isActive = !!info.isActive;
      var expiresAt = info.expiresAt || info.premium_until || null;
      setText('.wallet-status', isActive ? 'Premium Active' : 'Free');
      setText('.wallet-plan', isActive ? 'Premium' : 'Free');
      setText('.wallet-expiry', expiresAt ? new Date(expiresAt).toLocaleDateString() : '—');
    }).catch(function () {});
  }

  /* --- Admin overview / system --- */
  if (page === 'admin-overview') {
    apiFetch('/api/admin/system').then(safeJson).then(function (sys) {
      if (!sys) return;
      setText('.admin-stat-users', sys.user_count != null ? sys.user_count : '—');
      setText('.admin-stat-sources', sys.source_count != null ? sys.source_count : '—');
      setText('.admin-stat-posts', sys.post_count != null ? sys.post_count : '—');
    }).catch(function () {});
  }
})();
