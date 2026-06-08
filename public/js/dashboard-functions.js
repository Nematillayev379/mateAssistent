(function () {
  if (window._dfLoaded) return;
  window._dfLoaded = true;

  var userId = window.__userId;
  var token = window.__token;
  var cryptoPollInterval = null;
  var walletPrices = { monthly: 0, yearly: 0 };
  window.__selectedPlan = window.__selectedPlan || 'monthly';
  window.__payMethod = window.__payMethod || 'stars';

  // ─── Helpers ─────────────────────────────────
  function esc(str) { return String(str == null ? '' : str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g, '&#39;'); }
  function safeJson(r) {
    if (!r || !r.ok) return null;
    return r.json().catch(function () { return null; });
  }
  function $(s) { var els = document.querySelectorAll(s); if (els.length <= 1) return els[0]; return Array.from(els).find(function(el){ return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0; }) || els[0]; }
  function $$(s) { return document.querySelectorAll(s); }
  function setText(s, v) { var e = $(s); if (e) e.textContent = v != null ? v : ''; }
  function setAllText(s, v) { $$(s).forEach(function (e) { e.textContent = v != null ? v : ''; }); }
  function allFields(id) { return Array.from(document.querySelectorAll('[id="' + id + '"]')); }
  function fieldVisible(el) { return !!el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0); }
  function getFieldValue(id, fallback) {
    var fields = allFields(id);
    if (!fields.length) return fallback;
    var field = fields.find(fieldVisible) || fields[0];
    return 'value' in field ? field.value : (field.textContent || fallback);
  }
  function setFieldValue(id, value) { allFields(id).forEach(function (field) { if ('value' in field) field.value = value; else field.textContent = value; }); }
  function setFieldChecked(id, checked) { allFields(id).forEach(function (field) { if ('checked' in field) field.checked = checked; }); }

  // ─── Studio: AI Post ─────────────────────────
  window.generateAIPost = async function () {
    var prompt = $('#ai-prompt') && $('#ai-prompt').value;
    if (!prompt) { showToast('Mavzu kiriting!', 'error'); return; }
    var btn = $('#btn-ai'); if (btn) btn.disabled = true;
    var lang = window.__userLang || 'uz';
    var size = $('#ai-size')?.value || 'medium';
    try {
      var r = await apiFetch('/api/ai/smm', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ prompt:prompt, language:lang, size:size, withImage:!!$('#ai-image')?.checked }) });
      if (!r.ok) { var e = await r.json(); throw new Error(e.error || 'Xatolik'); }
      var d = await r.json();
      if (!d.text || d.text.length < 10) throw new Error('AI post yaratmadi. API kalitlarini tekshiring.');
      var box = $('#ai-result'); if (box) box.style.display = 'block';
      var txt = $('#ai-res-text'); if (txt) txt.textContent = d.text;
      var img = $('#ai-res-img');
      if (img) {
        if (d.imageBase64 || d.imageUrl) { img.src = d.imageBase64 || d.imageUrl; img.style.display = 'block'; }
        else img.style.display = 'none';
        window.__lastSmmImg = d.imageBase64 || null;
      }
    } catch (e) { showToast('Xatolik: '+e.message, 'error'); }
    finally { if (btn) btn.disabled = false; }
  };

  window.copyAIPost = function () {
    var t = $('#ai-res-text')?.textContent;
    if (t) navigator.clipboard.writeText(t).then(function(){showToast('Nusxalandi!','success');});
  };

  window.sendAIPost = async function () {
    var text = $('#ai-res-text')?.textContent;
    if (!text) return;
    var img = $('#ai-res-img');
    var payload = { text: text, prompt: $('#ai-prompt')?.value || '' };
    if (img && img.style.display !== 'none') {
      if (img.src?.startsWith('data:')) payload.imageBase64 = img.src;
      else payload.imageUrl = img.src;
    }
    try {
      var r = await apiFetch('/api/ai/post-to-channel', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      if (r.ok) showToast('Post kanalga yuborildi!','success'); else showToast('Xatolik','error');
    } catch (e) { showToast(e.message,'error'); }
  };

  // ─── Studio: Voice News ──────────────────────
  window.generateVoiceNews = async function () {
    var title = $('#voice-title')?.value?.trim() || '';
    var text = $('#voice-text')?.value?.trim() || '';
    if (!title && !text) { showToast('Sarlavha yoki matn kiriting','error'); return; }
    var st = $('#voice-status');
    if (st) st.textContent = 'Generatsiya...';
    try {
      var r = await apiFetch('/api/ai/voice-news', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ title:title, text:text, sendToChannel:!!$('#voice-to-channel')?.checked }) });
      var d = await r.json().catch(function(){ return {}; });
      if (r.ok) { showToast('Audio yuborildi','success'); if (st) st.textContent = 'Audio yuborildi'; }
      else { showToast(d.error||'Xatolik','error'); if (st) st.textContent = d.error||'Xatolik'; }
    } catch(e) { showToast('Aloqa xatosi','error'); if (st) st.textContent='Aloqa xatosi'; }
  };

  // ─── Studio: Music ─────────────────────────
  window.searchMusic = async function () {
    var q = $('#music-q')?.value;
    if (!q) return;
    var list = $('#music-list'); if (!list) return;
    list.innerHTML = '<p class="text-on-surface-variant">Qidirilmoqda...</p>';
    try {
      var r = await apiFetch('/api/music/search?q='+encodeURIComponent(q));
      var data = await r.json().catch(function(){ return []; });
      list.innerHTML = '';
      if (!data || !data.length) { list.innerHTML = '<p class="text-on-surface-variant">Natija topilmadi</p>'; return; }
      data.forEach(function(m){
        var vid = m.videoId || (m.url || '').match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1] || '';
        var title = esc(m.title || 'music');
        (function(vid, title){
          var div = document.createElement('div');
          div.className = 'flex items-center justify-between p-3 bg-[#111113] border border-[#1E1E22] rounded-xl mt-2';
          div.innerHTML = '<span class="font-body-md">'+title+'</span><div class="flex gap-2"><button class="dl-btn px-3 py-1.5 bg-primary-container text-on-primary-container rounded-lg text-sm font-bold">Download</button><button class="send-btn px-3 py-1.5 border border-outline-variant rounded-lg text-sm">Send</button></div>';
          div.querySelector('.dl-btn').onclick = function(){ downloadMusic(vid, title, this); };
          div.querySelector('.send-btn').onclick = function(){ sendMusic(vid, title, this); };
          list.appendChild(div);
        })(vid, title);
      });
    } catch(e) { list.innerHTML = '<p class="text-error">Xatolik</p>'; }
  };

  window.downloadMusic = async function (vid, title, btn) {
    var id = (vid||'').match(/[a-zA-Z0-9_-]{11}/)?.[0];
    if (!id) { showToast('ID topilmadi','error'); return; }
    if (btn) { btn.disabled=true; btn.textContent='...'; }
    try {
      var r = await apiFetch('/api/music/download/'+id+'?web=1');
      if (!r.ok) throw new Error('Yuklab olish xatosi');
      var blob = await r.blob();
      var ext = (r.headers.get('content-type')||'').includes('audio/mpeg')?'mp3':'m4a';
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (title||'music')+'.'+ext; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){URL.revokeObjectURL(a.href);},2000);
    } catch(e) { showToast('Xatolik: '+e.message,'error'); }
    finally { if (btn) { btn.disabled=false; btn.textContent='Download'; } }
  };

  window.sendMusic = async function (vid, title, btn) {
    var id = (vid||'').match(/[a-zA-Z0-9_-]{11}/)?.[0];
    if (!id) { showToast('ID topilmadi','error'); return; }
    if (btn) { btn.disabled=true; btn.textContent='...'; }
    try {
      var r = await apiFetch('/api/music/download/'+id+'?send=1');
      var d = await r.json().catch(function(){ return {}; });
      if (d.success) showToast(d.message||'Yuborildi!','success'); else throw new Error(d.error||'Xatolik');
    } catch(e) { showToast('Xatolik: '+e.message,'error'); }
    finally { if (btn) { btn.disabled=false; btn.textContent='Send'; } }
  };

  // ─── Studio: Media Download ──────────────────
  window.downloadMedia = async function (type, btn) {
    var urlEl = $('#dl-url');
    var url = urlEl ? urlEl.value.trim() : '';
    if (!url) { showToast('Havola kiriting','error'); return; }
    var btns = $$('#btn-dl-video, #btn-dl-audio');
    btns.forEach(function(b){ b.disabled=true; });
    if (btn) btn.innerHTML = 'Yuklanmoqda...';
    try {
      var r = await apiFetch('/api/media/download?web=1', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ url:url, type:type, delivery:'web' }) });
      if (!r.ok) { var e = await r.json(); throw new Error(e.error||'Xatolik'); }
      var blob = await r.blob();
      if (blob.size < 1000) throw new Error('Fayl juda kichik');
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'media_'+Date.now()+'.'+(type==='video'?'mp4':'m4a'); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 2000);
    } catch(e) { showToast('Xatolik: '+e.message,'error'); }
    finally { btns.forEach(function(b){ b.disabled=false; }); if (btn) btn.innerHTML = type==='video'?'Video':'Audio'; }
  };

  // ─── Music Enter key ─────────────────────────
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'music-q') searchMusic();
    if (e.key === 'Enter' && e.target && e.target.id === 'dl-url') {
      var dlBtn = $('#btn-dl-video');
      if (dlBtn) downloadMedia('video', dlBtn);
    }
  });

  // ─── Sources ────────────────────────────────
  window.loadSources = async function () {
    if (!userId) return;
    try {
      var r = await apiFetch('/api/sources/'+userId);
      var data = await r.json().catch(function(){ return null; });
      if (!Array.isArray(data)) return;
      var list = $('#sources-list'); if (list) {
        list.innerHTML = '';
        data.forEach(function(s){
          var sid = Number(s.id) || 0;
          if (sid <= 0) return;
          list.innerHTML += '<div class="flex items-center justify-between p-3 bg-[#111113] border border-[#1E1E22] rounded-xl mt-2"><div><p class="font-body-md font-bold">'+esc(s.name)+'</p><p class="text-on-surface-variant text-sm">'+esc(s.url?.substring(0,40))+'</p></div><button class="text-error text-sm px-3 py-1 border border-error/30 rounded-lg" data-del-source="'+sid+'">Delete</button></div>';
        });
        list.querySelectorAll('[data-del-source]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var sid = Number(btn.getAttribute('data-del-source'));
            if (sid > 0) deleteSource(sid);
          });
        });
      }
      setText('.stat-active-sources', data.length);
      setText('.sources-count', data.length + '/10');
      setText('.mobile-sources', data.length);
    } catch(e) {}
  };

  window.saveSource = async function () {
    var name = $('#src-name')?.value;
    var url = $('#src-url')?.value;
    if (!name || !url) { showToast('Name va URL kiriting','error'); return; }
    try {
      var r = await apiFetch('/api/sources/'+userId, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name:name, url:url }) });
      if (r.ok) { $('#src-name').value=''; $('#src-url').value=''; loadSources(); showToast('Manba qo\'shildi','success'); }
      else { var e = await r.json(); showToast(e.error||'Xatolik','error'); }
    } catch(e) { showToast('Xatolik','error'); }
  };

  window.deleteSource = async function (id) {
    if (!confirm('O\'chirilsinmi?')) return;
    await apiFetch('/api/sources/'+userId+'/'+id, { method:'DELETE' });
    loadSources();
  };

  // ─── Settings ───────────────────────────────
  window.saveSettings = async function () {
    var lang = getFieldValue('set-lang', 'uz');
    var ch = getFieldValue('set-channel', '');
    var kw = getFieldValue('set-keywords', '');
    var interval = Math.max(1, Math.min(1440, parseInt(getFieldValue('set-interval', '15') || '15', 10) || 15));
    var digest = getFieldValue('set-digest', 'false') === 'true';
    var digestTime = getFieldValue('set-digest-time', '09:00') || '09:00';
    try {
      var r = await apiFetch('/api/settings/'+userId+'/extended', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ language:lang, target_channel:ch, keywords:kw, interval_minutes:interval, daily_digest:digest, digest_time:digestTime }) });
      if (r.ok) {
        setFieldValue('set-lang', lang);
        setFieldValue('set-channel', ch);
        setFieldValue('set-keywords', kw);
        setFieldValue('set-interval', String(interval));
        setFieldValue('set-digest', digest ? 'true' : 'false');
        setFieldValue('set-digest-time', digestTime);
        showToast('Saved!','success');
      }
      else { var e = await r.json(); showToast(e.error||'Error','error'); }
    } catch(e) { showToast('Error','error'); }
  };

  window.removeMainChannel = async function () {
    if (!confirm('Kanalni olib tashlaysizmi?')) return;
    try {
      var r = await apiFetch('/api/settings/'+userId+'/extended', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ target_channel:'' }) });
      if (r.ok) { setFieldValue('set-channel', ''); showToast('Kanal olib tashlandi','success'); }
      else showToast('Xatolik','error');
    } catch(e) { showToast('Xatolik','error'); }
  };

  // ─── Channels ──────────────────────────────
  window.addChannel = async function () {
    var cid = $('#new-channel')?.value?.trim();
    if (!cid) { showToast('Channel ID kiriting','error'); return; }
    try {
      var r = await apiFetch('/api/channels/'+userId, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ channel_id:cid }) });
      if (r.ok) { $('#new-channel').value=''; loadChannels(); showToast('Kanal qo\'shildi','success'); }
      else showToast('Xatolik','error');
    } catch(e) { showToast('Xatolik','error'); }
  };

  window.loadChannels = async function () {
    try {
      var r = await apiFetch('/api/channels/'+userId);
      var data = await r.json().catch(function(){ return null; });
      var list = $('#channels-list'); if (!list) return;
      list.innerHTML = '';
      if (!Array.isArray(data) || !data.length) { list.innerHTML = '<p class="text-on-surface-variant">Kanal yo\'q</p>'; return; }
      data.forEach(function(ch){
        var cid = Number(ch.id) || 0;
        if (cid <= 0) return;
        list.innerHTML += '<div class="flex items-center justify-between p-3 bg-[#111113] border border-[#1E1E22] rounded-xl mt-2"><span class="font-body-md">'+esc(ch.channel_username||ch.channel_id)+'</span><button class="text-error text-sm px-3 py-1 border border-error/30 rounded-lg" data-del-channel="'+cid+'">Remove</button></div>';
      });
      list.querySelectorAll('[data-del-channel]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var cid = Number(btn.getAttribute('data-del-channel'));
          if (cid > 0) removeChannel(cid);
        });
      });
    } catch(e) {}
  };

  window.removeChannel = async function (id) {
    if (!confirm('O\'chirilsinmi?')) return;
    await apiFetch('/api/channels/'+userId+'/'+id, { method:'DELETE' });
    loadChannels();
  };

  // ─── Finance ──────────────────────────────
  window.loadFinance = async function () {
    try {
      var r = await apiFetch('/api/finance/prices');
      var d = await safeJson(r);
      if (!d) return;
      setText('.btc-price', '$' + (d.btc || '—'));
      setText('.usd-price', (d.usd || '—') + ' so\'m');
    } catch(e) {}
  };

  // ─── Premium / Wallet ─────────────────────
  function syncPayMethodButtons() {
    var activeMethod = window.__payMethod || 'stars';
    $$('.pay-method-btn').forEach(function(btn) {
      var method = btn.dataset.payMethod || 'stars';
      var baseClass = btn.dataset.baseClass || btn.className;
      var activeClass = btn.dataset.activeClass || '';
      var inactiveClass = btn.dataset.inactiveClass || '';
      btn.className = [baseClass, method === activeMethod ? activeClass : inactiveClass].filter(Boolean).join(' ').trim();
    });
  }

  window.setPayMethod = function (method) {
    if (!method) return;
    window.__payMethod = method;
    syncPayMethodButtons();
  };

  window.loadPremium = async function () {
    try {
      var r = await apiFetch('/api/premium-info');
      var d = await safeJson(r);
      if (d) {
        var isActive = !!d.isActive;
        var expiresAt = d.expiresAt || d.premium_until || null;
        walletPrices.monthly = Number(d.monthlyPrice || 25000);
        walletPrices.yearly = Number(d.yearlyPrice || 250000);
        setText('.wallet-status', isActive ? 'Premium Active' : 'Free');
        setText('.wallet-plan', isActive ? 'Premium' : 'Free');
        setText('.wallet-expiry', expiresAt ? new Date(expiresAt).toLocaleDateString() : '—');
        setText('.premium-badge', isActive ? 'PREMIUM' : 'FREE');
        setAllText('.wallet-monthly-price', walletPrices.monthly.toLocaleString() + ' UZS');
        setAllText('.wallet-yearly-price', walletPrices.yearly.toLocaleString() + ' UZS');
        setText('.wallet-summary-price', (window.__selectedPlan === 'yearly' ? walletPrices.yearly : walletPrices.monthly).toLocaleString() + ' UZS');
      }
    } catch(e) {}
    try {
      var p = await apiFetch('/api/payments/methods');
      var m = await safeJson(p) || {};
      var container = $('#payment-methods');
      if (container) {
        container.innerHTML = '';
        [['stars','Stars','⭐'], ['usdt','USDT (TRC-20)','💎'], ['ton','TON','💎']].forEach(function(item){
          var btn = document.createElement('button');
          btn.dataset.payMethod = item[0];
          btn.dataset.baseClass = 'pay-method-btn px-4 py-2 border rounded-lg text-sm transition-all';
          btn.dataset.activeClass = 'border-primary/30 bg-primary-container text-on-primary-container';
          btn.dataset.inactiveClass = 'border-outline-variant hover:bg-surface-container';
          btn.type = 'button';
          btn.textContent = item[1] + (m[item[0]] ? '' : ' (—)');
          btn.onclick = function(){ window.setPayMethod(item[0]); };
          container.appendChild(btn);
        });
        syncPayMethodButtons();
      }
    } catch(e) {}
  };

  window.buyPremium = async function (period) {
    try {
      var r = await apiFetch('/api/premium/buy', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ plan: period, method:window.__payMethod||'stars' }) });
      var d = await r.json().catch(function(){ return {}; });
      if (!d) d = {};
      if (d.request) {
        showCryptoPaymentModal(d.request);
        return;
      }
      if (d.url) {
        window.open(d.url, '_blank');
        return;
      }
      if (d.success) showToast('Premium aktiv!','success');
      else showToast(d.error||'Xatolik','error');
    } catch(e) { showToast('Xatolik','error'); }
  };

  // ─── Studio: RSS Search ─────────────────────
  function renderRssSearchResults(results, summary, topic) {
    var box = $('#rss-search-results');
    if (!box) return;

    if ((!results || !results.length) && !summary) {
      box.innerHTML = '<div class="flex flex-col items-center justify-center h-full text-muted"><span class="material-symbols-outlined opacity-30" style="font-size:36px">manage_search</span><p class="text-xs mt-2">Natijalar shu yerda</p></div>';
      return;
    }

    var html = '';
    if (summary) {
      html += '<div class="mb-4 p-3 rounded-xl border border-outline-variant bg-[#111113]">';
      html += '<div class="text-[10px] uppercase tracking-wider text-muted font-mono mb-2">Summary</div>';
      html += '<div class="text-sm leading-relaxed">' + esc(summary) + '</div>';
      html += '</div>';
    }

    if (results && results.length) {
      html += '<div class="space-y-3">';
      results.forEach(function (item, index) {
        html += '<div class="p-3 rounded-xl border border-outline-variant bg-[#111113]">';
        html += '<div class="flex items-start justify-between gap-3">';
        html += '<div class="min-w-0">';
        html += '<div class="text-[10px] text-muted font-mono uppercase tracking-wider mb-1">Result ' + (index + 1) + '</div>';
        html += '<h4 class="text-sm font-semibold leading-snug">' + esc(item.title || topic || 'RSS result') + '</h4>';
        if (item.source) html += '<p class="text-xs text-muted mt-1">' + esc(item.source) + '</p>';
        if (item.pubDate) html += '<p class="text-[10px] text-muted font-mono mt-1">' + esc(item.pubDate) + '</p>';
        if (item.url) html += '<a class="text-[11px] text-primary break-all mt-2 inline-block" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">' + esc(item.url) + '</a>';
        if (item.content) html += '<p class="text-xs text-on-surface-variant mt-2 line-clamp-3">' + esc(item.content) + '</p>';
        html += '</div>';
        if (item.relevanceScore != null) {
          html += '<div class="shrink-0 text-[10px] font-mono px-2 py-1 rounded bg-primary/10 text-primary">Score ' + esc(item.relevanceScore) + '</div>';
        }
        html += '</div>';
        html += '</div>';
      });
      html += '</div>';
    } else {
      html += '<div class="flex flex-col items-center justify-center h-full text-muted"><span class="material-symbols-outlined opacity-30" style="font-size:36px">search_off</span><p class="text-xs mt-2">Natija topilmadi</p></div>';
    }

    box.innerHTML = html;
  }

  window.loadSearchList = async function () {
    if (!userId) return;
    var list = $('#rss-search-list');
    if (!list) return;
    try {
      var r = await apiFetch('/api/rss-search/' + userId);
      var d = await safeJson(r) || {};
      var searches = Array.isArray(d.searches) ? d.searches : [];
      if (!searches.length) {
        list.innerHTML = 'Hozircha qidiruvlar yo\'q';
        return;
      }
      list.innerHTML = searches.map(function (s) {
        var mode = s.mode === 'daily' ? 'Daily' : 'Instant';
        var active = s.isActive ? 'Active' : 'Paused';
        return '<div class="flex items-center justify-between gap-3 p-3 mb-2 rounded-lg border border-outline-variant bg-[#111113]">' +
          '<div class="min-w-0">' +
          '<p class="text-sm font-semibold truncate">' + esc(s.topic || 'RSS search') + '</p>' +
          '<p class="text-[10px] text-muted font-mono mt-1">' + esc(mode) + ' · ' + esc(active) + '</p>' +
          '</div>' +
          '<button type="button" class="text-error hover:opacity-80" data-del-rss-search="' + esc(s.id) + '">' +
          '<span class="material-symbols-outlined" style="font-size:16px">delete</span>' +
          '</button>' +
          '</div>';
      }).join('');
      list.querySelectorAll('[data-del-rss-search]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-del-rss-search');
          if (id) window.deleteRssSearch(id);
        });
      });
    } catch (e) {
      list.textContent = 'Qidiruvlar yuklanmadi';
    }
  };

  window.deleteRssSearch = async function (searchId) {
    if (!searchId) return;
    if (!confirm('Qidiruv o\'chirilsinmi?')) return;
    try {
      var r = await apiFetch('/api/rss-search/' + userId + '/' + encodeURIComponent(searchId), { method: 'DELETE' });
      var d = await r.json().catch(function(){ return {}; });
      if (d && d.success) {
        showToast('Qidiruv o\'chirildi', 'success');
        window.loadSearchList();
      } else {
        showToast(d.error || 'Xatolik', 'error');
      }
    } catch (e) {
      showToast('Xatolik', 'error');
    }
  };

  window.runRssSearch = async function () {
    var topicEl = $('#rss-search-topic');
    var keywordsEl = $('#rss-search-keywords');
    var maxEl = $('#rss-search-max');
    var modeEl = $('#rss-search-mode');
    var topic = topicEl ? topicEl.value.trim() : '';
    if (!topic) { showToast('Mavzu kiriting', 'error'); return; }

    var keywords = keywordsEl && keywordsEl.value.trim()
      ? keywordsEl.value.split(',').map(function (k) { return k.trim(); }).filter(Boolean)
      : [];
    var maxResults = parseInt(maxEl && maxEl.value ? maxEl.value : '10', 10) || 10;
    var mode = modeEl && modeEl.value ? modeEl.value : 'instant';
    var resultsBox = $('#rss-search-results');
    if (resultsBox) {
      resultsBox.innerHTML = '<div class="flex items-center gap-2 text-muted"><span class="material-symbols-outlined animate-pulse" style="font-size:18px">progress_activity</span><span class="text-xs">Qidirilmoqda...</span></div>';
    }

    try {
      var r = await apiFetch('/api/rss-search/' + userId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: topic, keywords: keywords, maxResults: maxResults, mode: mode })
      });
      var d = await r.json().catch(function(){ return {}; });
      if (!r.ok || d.error) throw new Error(d.error || 'Qidiruv bajarilmadi');

      if (mode === 'instant') {
        renderRssSearchResults(d.results || [], d.summary || '', topic);
        showToast('Instant qidiruv yakunlandi', 'success');
      } else {
        renderRssSearchResults([], d.message || 'Qidiruv saqlandi va kunlik ishlaydi', topic);
        showToast('Kunlik qidiruv saqlandi', 'success');
      }

      if (topicEl) topicEl.value = '';
      if (keywordsEl) keywordsEl.value = '';
      window.loadSearchList();
    } catch (e) {
      if (resultsBox) {
        resultsBox.innerHTML = '<div class="flex flex-col items-center justify-center h-full text-error"><span class="material-symbols-outlined opacity-40" style="font-size:36px">error</span><p class="text-xs mt-2">' + esc(e.message || 'Xatolik') + '</p></div>';
      }
      showToast('Xatolik: ' + (e.message || 'Qidiruv bajarilmadi'), 'error');
    }
  };

  function closeCryptoModal() {
    var el = document.getElementById('crypto-payment-modal');
    if (el) el.remove();
    if (cryptoPollInterval) {
      clearInterval(cryptoPollInterval);
      cryptoPollInterval = null;
    }
  }

  function showCryptoPaymentModal(req) {
    closeCryptoModal();
    var overlay = document.createElement('div');
    overlay.id = 'crypto-payment-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    var box = document.createElement('div');
    box.style.cssText = 'background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:420px;width:100%;text-align:center;';
    var mk = function (tag, css, text) {
      var el = document.createElement(tag);
      if (css) el.style.cssText = css;
      if (text != null) el.textContent = String(text);
      return el;
    };
    var reqId = String(req.id == null ? '' : req.id);
    var wallet = String(req.walletAddress == null ? '' : req.walletAddress);
    var memo = String(req.memo == null ? '' : req.memo);
    var currency = String(req.currency == null ? '' : req.currency);
    var amount = String(req.cryptoAmount == null ? '' : req.cryptoAmount);
    box.appendChild(mk('h3', 'margin-bottom:12px;', currency + " to'lov"));
    box.appendChild(mk('p', 'color:var(--secondary);margin-bottom:6px;', 'Yuboriladigan summa'));
    box.appendChild(mk('div', 'font-size:1.7rem;font-weight:700;color:var(--accent);margin-bottom:14px;', amount + ' ' + currency));
    box.appendChild(mk('p', 'color:var(--secondary);margin-bottom:6px;', 'Hamyon manzili'));
    var walletBox = mk('div', 'background:rgba(255,255,255,0.05);border-radius:10px;padding:12px;font-size:0.75rem;word-break:break-all;margin-bottom:10px;font-family:monospace;', wallet);
    box.appendChild(walletBox);
    var copyBtn = mk('button', 'width:auto;padding:6px 12px;font-size:0.75rem;margin-bottom:14px;', '📋 Nusxalash');
    copyBtn.className = 'btn btn-ghost';
    copyBtn.addEventListener('click', function () {
      navigator.clipboard.writeText(wallet).then(function () { showToast("Manzil nusxalandi!", 'success'); }).catch(function () { showToast('Nusxalash amalga oshmadi', 'error'); });
    });
    box.appendChild(copyBtn);
    box.appendChild(mk('p', 'color:var(--secondary);margin-bottom:6px;', 'Memo'));
    box.appendChild(mk('div', 'background:rgba(255,255,255,0.05);border-radius:10px;padding:10px;font-size:1rem;font-weight:600;margin-bottom:14px;font-family:monospace;', memo));
    box.appendChild(mk('p', 'font-size:0.8rem;color:var(--secondary);margin-bottom:16px;', 'Aynan shu memoni transfer commentiga yozing.'));
    var row = mk('div', 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;');
    var verifyBtn = mk('button', '', "To'lov qildim");
    verifyBtn.className = 'btn btn-primary';
    verifyBtn.id = 'crypto-verify-btn';
    verifyBtn.addEventListener('click', function () { window.__verifyCryptoPayment(reqId); });
    var closeBtn = mk('button', '', 'Yopish');
    closeBtn.className = 'btn btn-ghost';
    closeBtn.addEventListener('click', function () { window.__closeCryptoModal(); });
    row.appendChild(verifyBtn);
    row.appendChild(closeBtn);
    box.appendChild(row);
    var status = mk('div', 'margin-top:12px;font-size:0.85rem;color:var(--secondary);');
    status.id = 'crypto-status';
    box.appendChild(status);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    cryptoPollInterval = setInterval(function () {
      apiFetch('/api/crypto-payment/status/' + encodeURIComponent(reqId), {
        method: 'POST',
        headers: { 'x-bot-token': token, 'x-user-id': userId, 'Content-Type': 'application/json' }
      }).then(function (r) {
        if (!r.ok) return null;
        return r.json();
      }).then(function (d) {
        if (d && d.status === 'paid') {
          showToast('Premium faollashtirildi!', 'success');
          closeCryptoModal();
          location.reload();
        }
      }).catch(function () {});
    }, 10000);
  }

  window.__closeCryptoModal = closeCryptoModal;
  window.__verifyCryptoPayment = async function (id) {
    var btn = document.getElementById('crypto-verify-btn');
    var statusEl = document.getElementById('crypto-status');
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = 'Tekshirilmoqda...';
    try {
      var r = await apiFetch('/api/crypto-payment/status/' + encodeURIComponent(id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      var d = await r.json().catch(function(){ return {}; });
      if (d.status === 'paid') {
        showToast('Premium faollashtirildi!', 'success');
        closeCryptoModal();
        location.reload();
      } else if (statusEl) {
        statusEl.textContent = 'To\'lov hali topilmadi. Bir ozdan keyin qayta urinib ko\'ring.';
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = 'Xatolik: ' + e.message;
    }
    if (btn) btn.disabled = false;
  };

  // ─── Admin ─────────────────────────────────
  window.loadAdminUsers = async function () {
    try {
      var r = await apiFetch('/api/admin/users');
      var data = await safeJson(r);
      if (!Array.isArray(data)) return;
      var tbody = $('#admin-users-tbody');
      if (!tbody) {
        var list = document.getElementById('admin-users-list');
        if (list) renderUsersApprovalsCards(list, data);
        return;
      }
      if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="8" class="px-5 py-12 text-center text-muted font-mono text-sm">Foydalanuvchilar yo\'q</td></tr>';
        return;
      }
      tbody.innerHTML = data.map(function(u){
        var role = (u.role || 'user');
        var roleLabel = role.toUpperCase();
        var roleStyle = role === 'owner' ? 'background:rgba(245,166,35,0.12);color:var(--accent-amber);border:1px solid rgba(245,166,35,0.2)'
          : role === 'admin' ? 'background:rgba(91,141,239,0.12);color:var(--accent-blue);border:1px solid rgba(91,141,239,0.2)'
          : role === 'premium' ? 'background:rgba(65,238,194,0.12);color:var(--accent-cyan);border:1px solid rgba(65,238,194,0.2)'
          : u.is_blocked || !u.is_active ? 'background:rgba(255,71,87,0.12);color:var(--accent-red);border:1px solid rgba(255,71,87,0.2)'
          : 'background:rgba(94,94,120,0.12);color:var(--text-muted);border:1px solid rgba(94,94,120,0.2)';
        var initial = (u.first_name || u.username || '?').charAt(0).toUpperCase();
        var initialBg = role === 'owner' ? 'bg-amber/10 text-tertiary'
          : role === 'admin' ? 'bg-primary/10 text-primary'
          : role === 'premium' || u.is_premium ? 'bg-secondary/10 text-secondary'
          : u.is_blocked || !u.is_active ? 'bg-error/10 text-error'
          : 'bg-elevated text-muted';
        var isPremium = u.is_premium;
        var isActive = u.is_active !== false && !u.is_blocked;
        var dotClass = isActive ? 'bg-success shadow-[0_0_8px_rgba(46,213,115,0.5)]' : (u.is_blocked || !u.is_active ? 'bg-error shadow-[0_0_8px_rgba(255,71,87,0.5)]' : 'bg-muted');
        var tid = Number(u.telegram_id) || 0;
        if (tid <= 0) return '';
        var actions = [];
        if (!u.is_approved) actions.push('<button class="block w-full text-left px-3 py-2 text-xs hover:bg-elevated text-success" data-admin-action="approve" data-tid="'+tid+'">✓ Approve</button>');
        if (u.is_active !== false && !u.is_blocked) actions.push('<button class="block w-full text-left px-3 py-2 text-xs hover:bg-elevated text-error" data-admin-action="block" data-tid="'+tid+'">⊘ Block</button>');
        else actions.push('<button class="block w-full text-left px-3 py-2 text-xs hover:bg-elevated text-success" data-admin-action="unblock" data-tid="'+tid+'">↻ Unblock</button>');
        if (isPremium) actions.push('<button class="block w-full text-left px-3 py-2 text-xs hover:bg-elevated text-error" data-admin-action="revoke" data-tid="'+tid+'">✕ Revoke Premium</button>');
        else actions.push('<button class="block w-full text-left px-3 py-2 text-xs hover:bg-elevated text-primary" data-admin-action="premium" data-tid="'+tid+'">★ Grant Premium</button>');
        return '<tr class="admin-row hover:bg-elevated/50 transition-all">' +
          '<td class="px-5 py-4 text-xs font-mono text-muted">'+tid+'</td>' +
          '<td class="px-5 py-4"><div class="flex items-center gap-2.5"><div class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold '+initialBg+'">'+initial+'</div><span class="text-sm font-medium">@'+esc(u.username || u.first_name || 'user')+'</span></div></td>' +
          '<td class="px-5 py-4"><span class="badge" style="'+roleStyle+'">'+roleLabel+'</span></td>' +
          '<td class="px-5 py-4">'+(isPremium ? '<span class="material-symbols-outlined text-secondary" style="font-size:18px;font-variation-settings:\'FILL\' 1">verified</span>' : '<span class="material-symbols-outlined text-muted" style="font-size:18px">remove_circle</span>')+'</td>' +
          '<td class="px-5 py-4 text-sm font-mono">'+(u.source_count != null ? u.source_count : 0)+'</td>' +
          '<td class="px-5 py-4 text-sm text-muted">'+esc((u.joined || u.created_at || '').toString().substring(0,10))+'</td>' +
          '<td class="px-5 py-4"><div class="w-2 h-2 rounded-full '+dotClass+'"></div></td>' +
          '<td class="px-5 py-4"><div class="relative"><button class="p-1.5 rounded-lg hover:bg-elevated transition-all text-muted" data-admin-menu="'+tid+'"><span class="material-symbols-outlined" style="font-size:18px">more_horiz</span></button><div class="admin-action-menu hidden absolute right-0 mt-1 w-40 bg-card border border-outline-variant rounded-lg shadow-lg z-50 py-1">'+actions.join('')+'</div></div></td>' +
        '</tr>';
      }).join('');
      tbody.querySelectorAll('[data-admin-action]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          var t = Number(btn.getAttribute('data-tid'));
          var a = btn.getAttribute('data-admin-action');
          if (t && a) adminUserAction(t, a);
        });
      });
      tbody.querySelectorAll('[data-admin-menu]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.preventDefault(); e.stopPropagation();
          adminUserActionMenu(btn, Number(btn.getAttribute('data-admin-menu')));
        });
      });
      var paginationEl = document.getElementById('admin-users-pagination');
      if (paginationEl) paginationEl.textContent = 'Jami: ' + data.length + ' ta foydalanuvchi';
    } catch(e) { console.error('loadAdminUsers:', e); }
  };

  function renderUsersApprovalsCards(container, data) {
    var pending = data.filter(function(u){ return !u.is_approved && u.is_active !== false; });
    var all = data;
    var pendingSection = container.querySelector('#view-queue .space-y-3');
    if (pendingSection) {
      if (!pending.length) {
        pendingSection.innerHTML = '<div class="text-center text-muted py-8">Kutilayotgan so\'rovlar yo\'q</div>';
      } else {
        pendingSection.innerHTML = pending.map(function(u) {
          var name = esc(u.first_name || u.username || 'User');
          var username = esc(u.username || 'user_' + u.telegram_id);
          var initial = name.charAt(0).toUpperCase();
          var lang = esc(u.language || 'en');
          var tid = Number(u.telegram_id) || 0;
          if (tid <= 0) return '';
          return '<div class="bg-surface-container border border-outline-variant rounded-xl p-4 flex flex-col gap-4">'+
            '<div class="flex justify-between items-start">'+
              '<div class="flex gap-3">'+
                '<div class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-sm font-bold">'+initial+'</div>'+
                '<div><p class="font-medium">'+name+'</p><p class="text-xs text-muted">@'+username+' · '+lang.toUpperCase()+'</p></div>'+
              '</div>'+
              '<span class="text-[10px] text-muted font-mono">'+esc((u.created_at||'').toString().substring(0,10))+'</span>'+
            '</div>'+
            '<div class="flex gap-2">'+
              '<button class="flex-1 bg-primary text-white py-2 rounded-lg text-sm font-semibold" data-pending-action="approve" data-tid="'+tid+'">Approve</button>'+
              '<button class="flex-1 bg-elevated text-error py-2 rounded-lg text-sm font-semibold border border-error/30" data-pending-action="reject" data-tid="'+tid+'">Reject</button>'+
            '</div>'+
          '</div>';
        }).join('');
        pendingSection.querySelectorAll('[data-pending-action]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var t = Number(btn.getAttribute('data-tid'));
            var a = btn.getAttribute('data-pending-action');
            if (t && a) adminUserAction(t, a);
          });
        });
      }
    }
    var allSection = container.querySelector('#view-all');
    if (allSection) {
      if (!all.length) {
        allSection.innerHTML = '<div class="text-center text-muted py-8">Foydalanuvchilar yo\'q</div>';
      } else {
        allSection.innerHTML = '<div class="space-y-2">' + all.map(function(u) {
          var name = esc(u.first_name || u.username || 'User');
          var username = esc(u.username || 'user_' + u.telegram_id);
          var initial = name.charAt(0).toUpperCase();
          var role = u.role || (u.is_premium ? 'premium' : 'user');
          return '<div class="bg-surface-container border border-outline-variant rounded-lg p-3 flex justify-between items-center">'+
            '<div class="flex gap-3 items-center">'+
              '<div class="w-8 h-8 rounded-full bg-elevated flex items-center justify-center text-xs font-bold">'+initial+'</div>'+
              '<div><p class="text-sm font-medium">'+name+'</p><p class="text-[10px] text-muted">@'+username+'</p></div>'+
            '</div>'+
            '<span class="text-[10px] uppercase font-mono px-2 py-1 rounded bg-elevated">'+role+'</span>'+
          '</div>';
        }).join('') + '</div>';
      }
    }
    var badge = document.getElementById('tab-queue');
    if (badge) badge.textContent = 'Approval Queue (' + pending.length + ')';
  }

  window.adminUserActionMenu = function (btn, tid) {
    document.querySelectorAll('.admin-action-menu').forEach(function(m){ if (m !== btn.nextElementSibling) m.classList.add('hidden'); });
    var menu = btn.nextElementSibling;
    if (menu) menu.classList.toggle('hidden');
  };

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.admin-action-menu') && !e.target.closest('[onclick*="adminUserActionMenu"]')) {
      document.querySelectorAll('.admin-action-menu').forEach(function(m){ m.classList.add('hidden'); });
    }
  });

  window.adminUserAction = async function (tid, action) {
    var urls = { approve:'/api/admin/users/'+tid+'/approve', block:'/api/admin/users/'+tid+'/block', unblock:'/api/admin/users/'+tid+'/unblock', reject:'/api/admin/users/'+tid+'/reject', premium:'/api/admin/users/'+tid+'/premium', revoke:'/api/admin/users/'+tid+'/premium' };
    var url = urls[action]; if (!url) { showToast('Unknown action: '+action, 'error'); return; }
    var body = (action==='premium'||action==='revoke') ? JSON.stringify({ days: action==='revoke' ? 0 : 30 }) : undefined;
    try {
      var r = await apiFetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:body });
      if (r.ok) { showToast('OK','success'); loadAdminUsers(); }
      else { var err = await r.json().catch(function(){return {};}); showToast(err.error || 'Error','error'); }
    } catch(e) { showToast('Error','error'); }
  };

  window.sendBroadcast = async function () {
    var msg = $('#broadcast-msg')?.value;
    if (!msg) { showToast('Xabar kiriting','error'); return; }
    try {
      var r = await apiFetch('/api/admin/broadcast', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ message:msg }) });
      if (r.ok) showToast('Yuborildi','success'); else showToast('Error','error');
    } catch(e) { showToast('Error','error'); }
  };

  window.saveAdminSettings = async function () {
    var stars = $('#premium-stars')?.value;
    var monthly = $('#premium-monthly')?.value;
    var yearly = $('#premium-yearly')?.value;
    var requireApproval = $('#require-approval')?.checked;
    try {
      var r = await apiFetch('/api/admin/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ premium_stars_price:stars, premium_monthly_price:monthly, premium_yearly_price:yearly, require_approval:requireApproval }) });
      if (r.ok) showToast('Saved','success'); else showToast('Error','error');
    } catch(e) { showToast('Error','error'); }
  };

  window.loadAdminSettings = async function () {
    try {
      var r = await apiFetch('/api/admin/settings');
      var d = await safeJson(r);
      if (!d) return;
      if ($('#premium-stars')) $('#premium-stars').value = d.premium_stars_price || '500';
      if ($('#premium-monthly')) $('#premium-monthly').value = d.premium_monthly_price || '25000';
      if ($('#premium-yearly')) $('#premium-yearly').value = d.premium_yearly_price || '250000';
      if ($('#require-approval')) $('#require-approval').checked = d.require_approval !== false;
    } catch(e) {}
  };

  window.loadSystemStatus = async function () {
    try {
      var r = await apiFetch('/api/admin/system');
      var d = await safeJson(r);
      if (!d) return;
      if (d) {
        var hours = Math.floor((d.uptime || 0) / 3600);
        var mins = Math.floor(((d.uptime || 0) % 3600) / 60);
        setText('.sys-uptime', hours + 's ' + mins + 'm');
        setText('.sys-version', d.version || d.nodeVersion || '—');
        setText('.sys-memory', d.memory_usage || (d.memory ? Math.round(d.memory.heapUsed/1024/1024)+' MB' : '—'));
        setText('.sys-node', d.nodeVersion || '—');
        setText('.sys-redis', d.redis ? 'Online' : 'Offline');

        if (typeof d.memory_pct === 'number') {
          var cpuBar = $('#cpu-bar'); if (cpuBar) cpuBar.style.width = d.memory_pct + '%';
          var cpuBarM = $('#cpu-bar-mobile'); if (cpuBarM) cpuBarM.style.width = d.memory_pct + '%';
          var cpuText = $('#cpu-text'); if (cpuText) cpuText.textContent = d.memory_pct + '%';
        }
        if (d.user_count != null) {
          var pendingBadge = $('.admin-stat-pending');
          if (pendingBadge) pendingBadge.textContent = d.pending_users || 0;
        }
      }
    } catch(e) { console.error('loadSystemStatus:', e); }
  };

  window.loadAdminStats = async function () {
    try {
      var r = await apiFetch('/api/admin/stats');
      var d = await safeJson(r);
      if (!d) return;
      setAllText('.admin-stat-users', (d.total_users || 0).toLocaleString());
      setAllText('.admin-stat-sources', (d.premium_users || 0).toLocaleString());
      setAllText('.admin-stat-posts', (d.posts_today || 0).toLocaleString());
      setAllText('.admin-stat-pending', String(d.pending_users || 0));
      setAllText('.admin-stat-uptime', (d.uptime_pct || '99.8') + '%');
      setAllText('.admin-stat-users-total', (d.total_users || 0).toLocaleString());
      setAllText('.admin-stat-free', (d.free_users || 0).toLocaleString());
      setAllText('.admin-stat-premium', (d.premium_users || 0).toLocaleString());
      setAllText('.admin-stat-revenue-month', d.revenue_month || '—');
    } catch(e) {}
  };

  window.loadApprovalQueue = async function () {
    var tbody = $('#approval-queue-tbody');
    var countEl = $('#approval-queue-count');
    if (!tbody) return;
    try {
      var r = await apiFetch('/api/admin/users?is_approved=false');
      var list = await safeJson(r);
      if (!Array.isArray(list) || !list.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-12 text-center text-on-surface-variant font-mono">Kutilayotgan so\'rovlar yo\'q</td></tr>';
        if (countEl) countEl.textContent = '0 ta so\'rov';
        return;
      }
      tbody.innerHTML = list.map(function(u) {
        var lang = (u.language || 'uz').toUpperCase();
        var flags = { UZ:'🇺🇿', RU:'🇷🇺', EN:'🇺🇸', ZH:'🇨🇳', IT:'🇮🇹', JA:'🇯🇵', TR:'🇹🇷', DE:'🇩🇪' };
        var flag = flags[lang] || '🌐';
        var tid = Number(u.telegram_id) || 0;
        if (tid <= 0) return '';
        return '<tr class="hover:bg-surface-container transition-colors">' +
          '<td class="px-6 py-4 font-label-sm text-primary">#'+tid+'</td>' +
          '<td class="px-6 py-4 font-medium">@'+esc(u.username || '—')+'</td>' +
          '<td class="px-6 py-4">'+esc(u.first_name || '—')+'</td>' +
          '<td class="px-6 py-4 text-on-surface-variant text-sm">'+esc((u.joined || u.created_at || '').toString().substring(0,10))+'</td>' +
          '<td class="px-6 py-4"><div class="flex items-center gap-2"><span class="text-lg">'+flag+'</span><span class="text-on-surface-variant text-sm uppercase">'+lang+'</span></div></td>' +
          '<td class="px-6 py-4 text-right"><div class="flex items-center justify-end gap-2">' +
            '<button data-approval-action="approve" data-tid="'+tid+'" class="w-8 h-8 rounded-lg bg-secondary/10 text-secondary hover:bg-secondary hover:text-white transition-all flex items-center justify-center"><span class="material-symbols-outlined text-[20px]">check</span></button>' +
            '<button data-approval-action="reject" data-tid="'+tid+'" class="w-8 h-8 rounded-lg bg-error/10 text-error hover:bg-error hover:text-white transition-all flex items-center justify-center"><span class="material-symbols-outlined text-[20px]">close</span></button>' +
          '</div></td>' +
        '</tr>';
      }).join('');
      tbody.querySelectorAll('[data-approval-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var t = Number(btn.getAttribute('data-tid'));
          var a = btn.getAttribute('data-approval-action');
          if (t && a) adminUserAction(t, a);
        });
      });
      if (countEl) countEl.textContent = list.length + ' ta so\'rov';
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="6" class="px-6 py-12 text-center text-error font-mono">Yuklashda xatolik</td></tr>';
    }
  };

  window.loadBroadcasts = async function () {
    var countEl = document.getElementById('broadcast-recipients-count');
    if (countEl) {
      try {
        var rc = await apiFetch('/api/admin/users?is_active=true');
        var list = await rc.json();
        countEl.textContent = (Array.isArray(list) ? list.length : 0).toLocaleString();
      } catch(e) { countEl.textContent = '—'; }
    }
  };

  // ─── Wallet: plan selection, TON, referral ────
  window.selectPlan = function (plan) {
    window.__selectedPlan = plan;
    var mCard = document.getElementById('plan-monthly-card');
    var yCard = document.getElementById('plan-yearly-card');
    if (mCard) mCard.className = (plan === 'monthly')
      ? 'gradient-border-card cursor-pointer active:scale-[0.97] transition-transform'
      : 'bg-card border border-outline-variant rounded-xl cursor-pointer hover:border-primary/50 active:scale-[0.97] transition-all';
    if (yCard) yCard.className = (plan === 'yearly')
      ? 'gradient-border-card cursor-pointer active:scale-[0.97] transition-transform'
      : 'bg-card border border-outline-variant rounded-xl cursor-pointer hover:border-primary/50 active:scale-[0.97] transition-all';
    var mRad = document.getElementById('plan-monthly');
    var yRad = document.getElementById('plan-yearly');
    if (mRad) mRad.checked = (plan === 'monthly');
    if (yRad) yRad.checked = (plan === 'yearly');
    var summary = document.querySelector('.wallet-summary-price');
    var mPrice = document.querySelector('.wallet-monthly-price');
    var yPrice = document.querySelector('.wallet-yearly-price');
    if (summary) {
      summary.textContent = plan === 'monthly'
        ? (mPrice ? mPrice.textContent.trim() : '125,000 UZS')
        : (yPrice ? yPrice.textContent.trim() : '1,200,000 UZS');
    }
  };

  window.copyRef = function (btn) {
    var link = document.getElementById('referral-link');
    var text = link ? link.textContent.trim() : (window.location.origin + '/register');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.origin + '/?ref=' + encodeURIComponent(text.replace(/^.*ref\//, ''))).catch(function(){});
    }
    if (btn) {
      var span = btn.querySelector('.material-symbols-outlined');
      if (span) { span.textContent = 'done'; setTimeout(function() { span.textContent = 'content_copy'; }, 2000); }
    }
    showToast('Referral link copied!', 'success');
  };

  window.shareRef = function () {
    var link = document.getElementById('referral-link');
    var code = link ? link.textContent.replace(/^.*ref\//, '').trim() : '';
    var refUrl = window.location.origin + '/?ref=' + encodeURIComponent(code);
    if (navigator.share) {
      navigator.share({ title: 'mateAssistent', text: 'Join mateAssistent!', url: refUrl }).catch(function(){});
    } else {
      window.copyRef(null);
    }
  };

  window.connectTonWallet = function () {
    var el = document.getElementById('ton-connect');
    var stateEl = document.getElementById('wallet-connection-state');
    if (!window.TonConnectUI) {
      if (stateEl) stateEl.textContent = 'TON Connect SDK not loaded';
      showToast('TON Connect SDK loading...', 'info');
      return;
    }
    if (window.__tonConnectUi) return;
    try {
      window.__tonConnectUi = new window.TonConnectUI({
        manifestUrl: window.location.origin + '/tonconnect-manifest.json',
        buttonRootId: 'ton-connect'
      });
      window.__tonConnectUi.onStatusChange(function (wallet) {
        if (stateEl) {
          if (wallet && wallet.account) {
            stateEl.textContent = 'Connected: ' + wallet.account.address.slice(0, 8) + '...' + wallet.account.address.slice(-6);
            apiFetch('/api/premium/wallet-claim', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ walletAddress: wallet.account.address })
            }).then(function(r){ return r.json().catch(function(){ return {}; }); }).then(function(d){
              if (d && d.success) showToast(d.message || 'Premium activated!', 'success');
            }).catch(function(){});
          } else {
            stateEl.textContent = '';
          }
        }
      });
    } catch(e) {
      if (stateEl) stateEl.textContent = 'TON Connect failed: ' + e.message;
    }
  };

  // ─── Automation: RSS Auto-Search ─────
  window.createAutoSearch = async function () {
    var topicEl = document.getElementById('rss-search-topic');
    var kwEl = document.getElementById('rss-search-keywords');
    var maxEl = document.getElementById('rss-search-max');
    var modeEl = document.getElementById('rss-search-mode');
    if (!topicEl || !topicEl.value.trim()) { showToast('Mavzu kiriting!', 'error'); return; }
    try {
      var r = await apiFetch('/api/rss-search/' + userId, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          topic: topicEl.value.trim(),
          keywords: kwEl ? kwEl.value.trim() : '',
          maxResults: maxEl ? parseInt(maxEl.value) || 10 : 10,
          mode: modeEl ? modeEl.value : 'realtime'
        })
      });
      var d = await r.json().catch(function(){ return {}; });
      if (r.ok && (d.success || d.id || d.searchId)) {
        showToast('Auto-search yaratildi!', 'success');
        if (window.loadAutoSearches) window.loadAutoSearches();
      } else {
        showToast(d.error || 'Xatolik', 'error');
      }
    } catch (e) { showToast('Tarmoq xatosi', 'error'); }
  };

  window.deleteAutoSearch = async function (id) {
    if (!confirm('Auto-search o\'chirilsinmi?')) return;
    try {
      var r = await apiFetch('/api/rss-search/' + userId + '/' + encodeURIComponent(id), { method: 'DELETE' });
      if (r.ok) {
        showToast('O\'chirildi', 'success');
        if (window.loadAutoSearches) window.loadAutoSearches();
      } else showToast('Xatolik', 'error');
    } catch (e) { showToast('Tarmoq xatosi', 'error'); }
  };

  window.runRssSearch = async function () {
    var queryEl = document.getElementById('rss-search-query');
    var limitEl = document.getElementById('rss-search-limit');
    var modeEl = document.getElementById('rss-search-mode');
    var query = queryEl ? queryEl.value.trim() : '';
    if (!query) { showToast('Qidiruv so\'zini kiriting', 'error'); return; }
    var limit = limitEl ? parseInt(limitEl.value) : 10;
    var mode = modeEl ? modeEl.value : 'instant';
    try {
      if (mode === 'daily') {
        var r = await apiFetch('/api/rss-search/' + userId, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: query, maxResults: limit, mode: 'daily' })
        });
        if (r.ok) { showToast('Kunlik qidiruv saqlandi!', 'success'); if (window.loadAutoSearches) loadAutoSearches(); }
        else { var e = await r.json().catch(function(){ return {}; }); showToast(e.error || 'Xatolik', 'error'); }
      } else {
        showToast('Qidirilmoqda...', 'success');
        var r2 = await apiFetch('/api/rss-search/' + userId, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: query, maxResults: limit, mode: 'instant' })
        });
        if (r2.ok) {
          var d = await r2.json();
          showToast('Topildi: ' + ((d.results && d.results.length) || 0) + ' ta natija', 'success');
          if (d.summary) showToast(d.summary.substring(0, 100), 'success');
        } else showToast('Xatolik', 'error');
      }
    } catch (e) { showToast('Tarmoq xatosi', 'error'); }
  };

  window.saveDraft = function () {
    var promptEl = document.getElementById('ai-prompt');
    var resultEl = document.getElementById('ai-result');
    var text = (promptEl ? promptEl.value : '') || (resultEl ? resultEl.innerText : '');
    if (!text) { showToast('Hech narsa yo\'q saqlash uchun', 'error'); return; }
    try {
      var drafts = JSON.parse(localStorage.getItem('studio_drafts') || '[]');
      drafts.unshift({ id: Date.now(), text: text, created_at: new Date().toISOString() });
      localStorage.setItem('studio_drafts', JSON.stringify(drafts.slice(0, 50)));
      showToast('Draft saqlandi!', 'success');
    } catch (e) { showToast('Xatolik', 'error'); }
  };

  window.viewAllDrafts = function () {
    var drafts = JSON.parse(localStorage.getItem('studio_drafts') || '[]');
    if (!drafts.length) { showToast('Draftlar yo\'q', 'error'); return; }
    var txt = drafts.map(function (d, i) { return (i+1) + '. ' + (d.text.substring(0, 100)) + '...'; }).join('\n\n');
    alert('Sizning draftlaringiz (' + drafts.length + ' ta):\n\n' + txt);
  };

  window.newDraft = function () {
    var promptEl = document.getElementById('ai-prompt');
    var resultEl = document.getElementById('ai-result');
    if (promptEl) promptEl.value = '';
    if (resultEl) resultEl.innerHTML = '<span class="text-muted text-sm">AI natijasi shu yerda paydo bo\'ladi...</span>';
    if (promptEl) promptEl.focus();
  };

  window.upgradeToPro = function (plan) {
    if (typeof buyPremium === 'function') buyPremium(plan || 'monthly');
    else window.location.href = '/dashboard/wallet.html';
  };

  window.unlockPremium = function () {
    var card = document.getElementById('plan-monthly-card');
    if (card) card.scrollIntoView({ behavior: 'smooth' });
    else window.location.href = '/dashboard/wallet.html';
  };

  window.viewAffiliateStats = function () {
    if (typeof apiFetch === 'function') {
      apiFetch('/api/referral/' + userId).then(function(r) { return r.json().catch(function(){ return null; }); }).then(function(d) {
        var msg = 'Referral kod: ' + (d.code || '—') + '\n';
        msg += 'Taklif qilganlar: ' + ((d.stats && d.stats.invited) || 0) + '\n';
        msg += 'Bonus: ' + ((d.stats && d.stats.bonus) || 0) + ' UZS\n';
        msg += 'Link: ' + (d.refLink || '—');
        alert(msg);
      }).catch(function() { alert('Ma\'lumot olishda xatolik'); });
    }
  };

  window.logout = function () {
    if (!confirm('Tizimdan chiqmoqchimisiz?')) return;
    try {
      fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(function () {});
      localStorage.removeItem('bot_token');
      localStorage.removeItem('bot_user_id');
      localStorage.removeItem('dashboard_token');
      localStorage.removeItem('dashboard_user');
      localStorage.removeItem('user_id');
    } catch(e) {}
    window.location.href = '/login.html';
  };

  window.rotateApiKey = function () {
    if (!confirm('API kalitni yangilashni xohlaysizmi?')) return;
    showToast('Hozircha bu funksiya tez kunda qo\'shiladi', 'success');
  };

  window.copyApiKey = function (btn) {
    var keyEl = document.getElementById('api-key-display');
    if (!keyEl) return;
    var txt = keyEl.innerText || keyEl.textContent || '';
    if (!txt || txt === '—') { showToast('Kalit mavjud emas', 'error'); return; }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(function() { showToast('Nusxalandi!', 'success'); }).catch(function() { showToast('Xatolik', 'error'); });
    } else {
      try { var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showToast('Nusxalandi!', 'success'); } catch(e) { showToast('Xatolik', 'error'); }
    }
  };

  window.createRule = function () {
    var queryEl = document.getElementById('rss-search-query');
    var query = queryEl ? queryEl.value.trim() : '';
    if (query) { createAutoSearch(); return; }
    var name = prompt('Qoida nomi:');
    if (!name) return;
    var trigger = prompt('Trigger (keyword, source, time, category):', 'keyword') || 'keyword';
    var action = prompt('Action (block, allow, tag, highlight):', 'allow') || 'allow';
    apiFetch('/api/rules/' + userId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger: trigger, condition: name, action: action, actionValue: '' })
    }).then(function(r) {
      if (r.ok) showToast('Qoida yaratildi!', 'success');
      else showToast('Xatolik', 'error');
    }).catch(function() { showToast('Tarmoq xatosi', 'error'); });
  };

  window.trackProduct = function () {
    var url = prompt('Mahsulot URL (olx.uz, market yoki ijtimoiy tarmoq):');
    if (!url) return;
    apiFetch('/api/rss-search/' + userId, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: url, interval_minutes: 60 })
    }).then(function(r) {
      if (r.ok) showToast('Kuzatuv boshlandi!', 'success');
      else showToast('Xatolik', 'error');
    }).catch(function() { showToast('Tarmoq xatosi', 'error'); });
  };

  window.editRule = function (id) { showToast('Tez kunda: ' + id, 'success'); };
  window.deleteRule = function (id) {
    if (!confirm('O\'chirilsinmi?')) return;
    apiFetch('/api/rules/' + userId + '/' + id, { method: 'DELETE' })
      .then(function(r) { if (r.ok) { showToast('O\'chirildi', 'success'); location.reload(); } });
  };

  window.loadAutoSearches = async function () {
    var container = document.getElementById('auto-search-list');
    if (!container) return;
    try {
      var r = await apiFetch('/api/rss-search/' + userId);
      var list = await r.json().catch(function(){ return []; });
      if (!Array.isArray(list) || !list.length) {
        container.innerHTML = '<p class="text-xs text-muted font-mono p-4">Auto-search mavjud emas. Yuqoridagi forma orqali yarating.</p>';
        return;
      }
      container.innerHTML = list.map(function (item) {
        return '<div class="bg-card border border-outline-variant rounded-xl p-4 flex items-center justify-between" data-id="' + esc(item.id) + '">' +
          '<div><p class="text-sm font-semibold">' + esc(item.topic || item.name || 'Untitled') + '</p>' +
          '<p class="text-[10px] text-muted font-mono mt-1">' + esc(item.keywords || '') + '</p></div>' +
          '<button data-del-auto-search="' + esc(item.id) + '" class="text-error/70 hover:text-error"><span class="material-symbols-outlined" style="font-size:18px">delete</span></button>' +
          '</div>';
      }).join('');
      container.querySelectorAll('[data-del-auto-search]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-del-auto-search');
          if (id) window.deleteAutoSearch(id);
        });
      });
    } catch (e) {}
  };

  // ─── Admin: tabs and toolbar helpers ──────
  window.switchTab = function (tab) {
    var queueTab = document.getElementById('tab-queue');
    var allTab = document.getElementById('tab-all');
    var queuePanel = document.getElementById('queue-panel');
    var allPanel = document.getElementById('all-panel');
    if (queueTab && allTab) {
      [queueTab, allTab].forEach(function (t) {
        t.classList.remove('bg-primary/10', 'text-primary', 'border-primary');
        t.classList.add('text-muted');
      });
      var active = tab === 'queue' ? queueTab : allTab;
      active.classList.add('bg-primary/10', 'text-primary', 'border-primary');
      active.classList.remove('text-muted');
    }
    if (queuePanel) queuePanel.style.display = (tab === 'queue') ? 'block' : 'none';
    if (allPanel) allPanel.style.display = (tab === 'all') ? 'block' : 'none';
  };

  window.wrapTag = function (tag) {
    var ta = document.getElementById('broadcast-msg');
    if (!ta) return;
    var s = ta.selectionStart, e = ta.selectionEnd;
    var sel = ta.value.substring(s, e);
    var open = (tag === 'a') ? '<a href="">' : '<' + tag + '>';
    var close = '</' + tag + '>';
    var next = ta.value.substring(0, s) + open + sel + close + ta.value.substring(e);
    ta.value = next;
    ta.focus();
    if (typeof updatePreview === 'function') updatePreview();
  };

  window.approveAllPending = async function () {
    if (!confirm('Hammasi tasdiqlansinmi?')) return;
    try {
      var r = await apiFetch('/api/admin/users/approve-all', { method: 'POST' });
      if (r.ok) { showToast('Tasdiqlandi!', 'success'); setTimeout(function() { location.reload(); }, 800); }
      else showToast('Xatolik', 'error');
    } catch (e) { showToast('Tarmoq xatosi', 'error'); }
  };

  window.exportUsersCSV = async function () {
    try {
      var r = await apiFetch('/api/admin/users');
      var list = await r.json().catch(function(){ return []; });
      if (!Array.isArray(list) || !list.length) { showToast('Foydalanuvchi yo\'q', 'info'); return; }
      var headers = ['telegram_id','username','first_name','role','is_active','is_approved','is_premium','target_channel','referral_code'];
      var rows = [headers.join(',')];
      list.forEach(function (u) {
        rows.push(headers.map(function (h) {
          var v = u[h]; if (typeof v === 'string') v = '"' + v.replace(/"/g, '""') + '"';
          return v == null ? '' : v;
        }).join(','));
      });
      var blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'users-' + Date.now() + '.csv'; a.click();
      URL.revokeObjectURL(url);
      showToast('CSV yuklandi', 'success');
    } catch (e) { showToast('Export xatosi', 'error'); }
  };

  // ─── User Overview Dashboard ──────────────
  window.loadOverview = async function () {
    try {
      var r = await apiFetch('/api/overview/' + userId);
      var d = await safeJson(r);
      if (!d) return;
      var posts = d.total_posts ?? 0;
      var srcs = d.active_sources ?? 0;
      var blocked = d.duplicates_blocked ?? 0;
      var aiReq = d.ai_requests ?? 0;
      document.querySelectorAll('.desktop-total-posts').forEach(function (el) { el.textContent = posts.toLocaleString(); });
      document.querySelectorAll('.mobile-total-posts').forEach(function (el) { el.textContent = posts.toLocaleString(); });
      document.querySelectorAll('.desktop-sources').forEach(function (el) { el.textContent = srcs; });
      document.querySelectorAll('.mobile-sources').forEach(function (el) { el.textContent = srcs; });
      document.querySelectorAll('.desktop-duplicates').forEach(function (el) { el.textContent = blocked.toLocaleString(); });
      document.querySelectorAll('.mobile-duplicates').forEach(function (el) { el.textContent = blocked.toLocaleString(); });
      document.querySelectorAll('.desktop-ai-requests').forEach(function (el) { el.textContent = aiReq; });
      document.querySelectorAll('.mobile-ai-requests').forEach(function (el) { el.textContent = aiReq; });
      setText('.bot-memory', d.memory_mb ? d.memory_mb + ' MB' : '—');
      setText('.bot-latency', d.api_latency_ms ? d.api_latency_ms + ' ms' : '—');
      setText('.bot-instance', d.bot_status || 'ACTIVE');
      var cap = d.capacity_pct || 0;
      var bars = document.querySelectorAll('.bot-capacity-bar');
      bars.forEach(function (b, i) {
        b.classList.remove('bg-secondary', 'bg-warning', 'bg-error', 'bg-elevated');
        if (i * 20 < cap) {
          if (cap >= 80) b.classList.add('bg-error');
          else if (cap >= 60) b.classList.add('bg-warning');
          else b.classList.add('bg-secondary');
        } else { b.classList.add('bg-elevated'); }
      });
      setText('.bot-capacity-text', cap ? (cap + '% capacity used') : '—');
      var feed = document.getElementById('activity-feed');
      var allowedIcons = { 'error': 1, 'auto_awesome': 1, 'fiber_manual_record': 1, 'check_circle': 1, 'article': 1, 'post_add': 1, 'campaign': 1, 'schedule': 1, 'add_circle': 1, 'edit': 1, 'delete': 1, 'image': 1, 'share': 1, 'link': 1, 'bolt': 1, 'cloud': 1, 'mail': 1, 'send': 1, 'settings': 1, 'analytics': 1, 'monitoring': 1, 'workspaces': 1, 'wallet': 1, 'verified': 1, 'notifications': 1, 'person': 1, 'groups': 1, 'chat': 1, 'rss_feed': 1, 'history': 1, 'info': 1, 'warning': 1, 'pending': 1 };
      var safeIcon = function (raw) {
        var v = String(raw || '').trim();
        if (!v) return 'fiber_manual_record';
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(v) || v.length > 40 || !allowedIcons[v]) return 'fiber_manual_record';
        return v;
      };
      if (feed && Array.isArray(d.activity) && d.activity.length) {
        feed.innerHTML = d.activity.slice(0, 8).map(function (a) {
          return '<div class="px-6 py-3 flex items-start gap-3"><span class="material-symbols-outlined text-primary mt-0.5" style="font-size:18px">'+safeIcon(a.icon)+'</span><div class="flex-1 min-w-0"><p class="text-sm">'+esc(a.text)+'</p><p class="text-[10px] text-muted font-mono mt-0.5">'+esc(a.time||'')+'</p></div></div>';
        }).join('');
      } else if (feed) {
        feed.innerHTML = '<div class="px-6 py-6 text-center text-sm text-muted">Hozircha faollik yo\'q</div>';
      }
      var mobileFeed = document.getElementById('activity-feed-mobile');
      if (mobileFeed && Array.isArray(d.activity) && d.activity.length) {
        mobileFeed.innerHTML = d.activity.slice(0, 5).map(function (a) {
          var icon = safeIcon(a.icon);
          var color = icon === 'error' ? 'text-error' : (icon === 'auto_awesome' ? 'text-purple' : 'text-primary');
          var bg = icon === 'error' ? 'bg-error/10' : (icon === 'auto_awesome' ? 'bg-purple/10' : 'bg-primary/10');
          var badge = icon === 'auto_awesome' ? 'AI' : (icon === 'error' ? 'Skip' : 'Done');
          var badgeClass = icon === 'auto_awesome' ? 'bg-purple/10 text-purple' : (icon === 'error' ? 'bg-elevated text-muted' : 'bg-success/10 text-success');
          return '<div class="p-4 flex items-center justify-between">'+
            '<div class="flex items-center gap-3">'+
              '<div class="w-8 h-8 rounded-lg '+bg+' flex items-center justify-center">'+
                '<span class="material-symbols-outlined '+color+'" style="font-size:16px">'+icon+'</span>'+
              '</div>'+
              '<div><p class="text-sm font-medium">'+esc(a.text)+'</p>'+
              '<p class="text-[10px] text-muted font-mono">'+esc(a.time||'')+'</p></div>'+
            '</div>'+
            '<span class="text-[9px] font-mono font-semibold px-2 py-0.5 rounded-full '+badgeClass+'">'+badge+'</span>'+
          '</div>';
        }).join('');
      } else if (mobileFeed) {
        mobileFeed.innerHTML = '<div class="p-4 text-center text-sm text-muted">Hozircha faollik yo\'q</div>';
      }
    } catch (e) { console.error('loadOverview:', e); }
  };

  window.publishNow = async function () {
    try {
      showToast('Yuborilmoqda...', 'success');
      var r = await apiFetch('/api/posts/publish-now/' + userId, { method: 'POST' });
      if (r.ok) { showToast('Post yuborildi!', 'success'); if (window.loadOverview) setTimeout(loadOverview, 500); }
      else { var e = await r.json().catch(function(){ return {}; }); showToast(e.error || 'Xatolik', 'error'); }
    } catch (e) { showToast('Tarmoq xatosi', 'error'); }
  };

  window.generateAI = async function () {
    try {
      showToast('AI generatsiya qilinyapti...', 'success');
      var r = await apiFetch('/api/posts/generate/' + userId, { method: 'POST' });
      if (r.ok) { showToast('AI tayyor!', 'success'); if (window.loadOverview) setTimeout(loadOverview, 500); }
      else { var e = await r.json().catch(function(){ return {}; }); showToast(e.error || 'Xatolik', 'error'); }
    } catch (e) { showToast('Tarmoq xatosi', 'error'); }
  };

  // ─── Settings Page ────────────────────────
  window.loadSettings = async function () {
    try {
      var r = await apiFetch('/api/settings/' + userId + '/extended');
      var s = await safeJson(r);
      if (!s) return;
      setFieldValue('set-lang', s.language || 'uz');
      setFieldValue('set-channel', s.target_channel || '');
      setFieldValue('set-keywords', s.keywords || '');
      setFieldValue('set-interval', String(s.interval_minutes || 15));
      setFieldValue('set-digest', s.daily_digest ? 'true' : 'false');
      setFieldValue('set-digest-time', s.digest_time || '09:00');
    } catch (e) { console.error('loadSettings:', e); }
  };

  // ─── Studio Page ──────────────────────────
  window.loadStudio = async function () {
    try {
      var r = await apiFetch('/api/studio/' + userId);
      var d = await safeJson(r);
      if (!d) return;
      setText('.studio-posts-today', d.posts_today ?? 0);
      setText('.studio-posts-week', d.posts_week ?? 0);
      setText('.studio-credits-left', d.ai_credits ?? 0);
      setText('.studio-last-ai', d.last_ai_use || '—');
      var recent = document.getElementById('studio-recent');
      if (recent && Array.isArray(d.recent)) {
        if (!d.recent.length) {
          recent.innerHTML = '<div class="px-6 py-6 text-center text-sm text-muted">Hozircha postlar yo\'q</div>';
        } else {
          recent.innerHTML = d.recent.slice(0, 10).map(function (p) {
            return '<div class="px-6 py-3 flex items-start gap-3"><span class="material-symbols-outlined text-primary mt-0.5" style="font-size:18px">article</span><div class="flex-1 min-w-0"><p class="text-sm font-medium truncate">'+esc(p.title||'(no title)')+'</p><p class="text-[10px] text-muted font-mono mt-0.5">'+esc(p.time||'')+' · ' + esc(p.channel||'') + '</p></div><span class="text-[10px] font-mono text-muted">'+esc(p.status||'sent')+'</span></div>';
          }).join('');
        }
      }
      var drafts = document.getElementById('studio-drafts-list');
      if (drafts) {
        try {
          var saved = JSON.parse(localStorage.getItem('studio_drafts') || '[]');
          if (saved.length) {
            drafts.innerHTML = saved.slice(0, 10).map(function (d, i) {
              return '<div class="min-w-[260px] bg-card border border-outline-variant rounded-xl p-4 flex-shrink-0 hover:border-primary/30 transition-all cursor-pointer" data-draft-idx="'+i+'">'+
                '<div class="flex justify-between items-start mb-2"><span class="badge badge-cyan">Local</span></div>'+
                '<p class="text-sm line-clamp-3 mb-3">'+esc(d.text.substring(0, 120))+'</p>'+
                '<p class="text-[10px] text-muted font-mono">'+esc(new Date(d.created_at).toLocaleString('uz-UZ'))+'</p>'+
              '</div>';
            }).join('');
            drafts.querySelectorAll('[data-draft-idx]').forEach(function (el) {
              el.addEventListener('click', function () {
                var idx = Number(el.getAttribute('data-draft-idx'));
                var item = saved[idx];
                if (item) showToast('Draft: ' + (item.text || '').substring(0, 50), 'success');
              });
            });
          } else { drafts.innerHTML = ''; }
        } catch (e) { drafts.innerHTML = ''; }
      }
    } catch (e) { console.error('loadStudio:', e); }
  };

  // ─── Distribution (extra channels) ────────
  window.loadDistribution = async function () {
    return loadChannels();
  };

  // ─── Analytics (charts + counters) ─────────
  window.loadAnalytics = async function () {
    try {
      var r = await apiFetch('/api/analytics/' + userId);
      var d = await safeJson(r);
      if (!d) return;
      setText('.analytics-active-users', d.active_users ?? 0);
      setText('.analytics-engagement', d.engagement_pct ?? '—');
      setText('.analytics-error-rate', d.error_rate_pct ?? '—');
      setText('.analytics-avg-response', d.avg_response_ms ? d.avg_response_ms + ' ms' : '—');
      setText('.analytics-posts-week', (d.posts_week ?? 0).toLocaleString());
      setText('.analytics-ai-saved', (d.ai_saved ?? 0).toLocaleString());
      setText('.btc-price', d.btc_usd ? ('$' + Number(d.btc_usd).toLocaleString()) : '—');
      setText('.usd-uzs', d.usd_uzs ? Number(d.usd_uzs).toLocaleString() : '—');
      setText('.analytics-views', d.total_views ? Number(d.total_views).toLocaleString() : '—');
      var bar = document.querySelectorAll('.analytics-day-bar');
      if (Array.isArray(d.daily_posts) && bar.length) {
        var max = Math.max.apply(null, d.daily_posts.concat([1]));
        bar.forEach(function (b, i) {
          var v = d.daily_posts[i] || 0;
          b.style.height = Math.max(8, (v / max) * 100) + '%';
        });
      }
    } catch (e) { console.error('loadAnalytics:', e); }
  };

  // ─── Wallet / Premium Page ───────────────
  window.loadWallet = async function () {
    try {
      var r = await apiFetch('/api/wallet/' + userId);
      var d = await safeJson(r);
      if (!d) return;
      setText('.wallet-balance', d.balance != null ? d.balance.toLocaleString() + ' UZS' : '0 UZS');
      setText('.wallet-plan', d.plan || 'Free');
      setText('.wallet-status', d.is_premium ? 'Premium faol' : 'Bepul tarif');
      setText('.wallet-expiry', d.premium_expires || d.expiresAt || '—');
      setText('.wallet-monthly-price', (d.pricing && d.pricing.monthly) ? (d.pricing.monthly.toLocaleString() + ' UZS') : '—');
      setText('.wallet-yearly-price', (d.pricing && d.pricing.yearly) ? (d.pricing.yearly.toLocaleString() + ' UZS') : '—');
      setText('.wallet-summary-price', d.is_premium ? 'Faol' : '—');
      var badge = document.querySelector('.premium-badge');
      if (badge) badge.style.display = d.is_premium ? '' : 'none';
    } catch (e) { console.error('loadWallet:', e); }
  };

  // ─── Admin User Actions (block/unblock/approve/premium) ────
  window.adminUserAction = async function (uid, action) {
    try {
      var r = await apiFetch('/api/admin/users/' + uid + '/' + action, { method: 'POST' });
      if (r.ok) { showToast('OK', 'success'); loadAdminUsers(); }
      else { var e = await r.json(); showToast(e.error || 'Xatolik', 'error'); }
    } catch (e) { showToast('Tarmoq xatosi', 'error'); }
  };

  // ─── Admin AI Keys ────────────────────────
  window.loadAdminKeys = async function () {
    try {
      var r = await apiFetch('/api/admin/ai-keys');
      var d = await safeJson(r);
      if (!d) return;
      var set = function (sel, v) { var el = document.querySelector(sel); if (el) el.textContent = v; };
      set('.ai-keys-total', d.total ?? 0);
      set('.ai-keys-active', d.active ?? 0);
      set('.ai-keys-blocked', d.blocked ?? 0);
      var tbody = document.getElementById('ai-keys-tbody');
      if (tbody && Array.isArray(d.keys)) {
        if (!d.keys.length) {
          tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-6">Kalitlar yo\'q</td></tr>';
        } else {
          tbody.innerHTML = d.keys.map(function (k) {
            return '<tr class="border-t border-outline-variant">'+
              '<td class="px-4 py-3 text-sm font-mono">'+esc(k.name||k.id||'')+'</td>'+
              '<td class="px-4 py-3 text-sm">'+esc(k.provider||'')+'</td>'+
              '<td class="px-4 py-3 text-sm">'+esc(k.status||'unknown')+'</td>'+
              '<td class="px-4 py-3 text-sm font-mono">'+esc(k.usage||'0')+'</td>'+
              '<td class="px-4 py-3 text-sm">'+esc(k.last_used||'—')+'</td>'+
            '</tr>';
          }).join('');
        }
      }
    } catch (e) { console.error('loadAdminKeys:', e); }
  };

  // ─── Auto-init based on data-page ──────────
  var page = document.body?.getAttribute('data-page');
  if (page === 'sources') { loadSources(); }
  if (page === 'distribution') { loadChannels(); }
  if (page === 'wallet') { loadWallet(); }
  if (page === 'admin-users' || page === 'admin-users-approvals') { loadAdminUsers(); }
  if (page === 'admin-system' || page === 'admin-overview' || page === 'admin-index') { loadSystemStatus(); loadAdminStats(); }
  if (page === 'admin-approval-queue') { loadApprovalQueue(); }
  if (page === 'admin-broadcast' || page === 'admin-broadcast-center') { loadBroadcasts(); }
  if (page === 'admin-system-config' || page === 'admin-pricing') { loadAdminSettings(); }
  if (page === 'admin-ai-keys') { loadAdminKeys(); }
  if (page === 'analytics') { loadAnalytics(); }
  if (page === 'automation') { loadAutomation(); }
  if (page === 'overview') { loadOverview(); }
  if (page === 'settings') { loadSettings(); }
  if (page === 'studio') { loadStudio(); }

  // Backward-compat for old SPA-style onclick
  window.$ = $;
  window.$$= $$;
  window.setText = setText;
  window.setAllText = setAllText;
  window.safeJson = safeJson;
})();
