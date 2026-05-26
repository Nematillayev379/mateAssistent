(function () {
  if (window._dfLoaded) return;
  window._dfLoaded = true;

  var userId = window.__userId;
  var token = window.__token;

  // ─── Helpers ─────────────────────────────────
  function esc(str) { return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function $(s) { return document.querySelector(s); }
  function $$(s) { return document.querySelectorAll(s); }
  function setText(s, v) { var e = $(s); if (e) e.textContent = v != null ? v : ''; }

  // ─── Studio: AI Post ─────────────────────────
  window.generateAIPost = async function () {
    var prompt = $('#ai-prompt') && $('#ai-prompt').value;
    if (!prompt) { showToast('Mavzu kiriting!', 'error'); return; }
    var btn = $('#btn-ai'); if (btn) btn.disabled = true;
    var lang = $('#post-lang') ? $('#post-lang').value : (window.__userLang || 'uz');
    try {
      var r = await apiFetch('/api/ai/smm', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ prompt:prompt, language:lang, withImage:!!$('#ai-image')?.checked }) });
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
      var d = await r.json();
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
      var data = await r.json();
      list.innerHTML = '';
      if (!data || !data.length) { list.innerHTML = '<p class="text-on-surface-variant">Natija topilmadi</p>'; return; }
      data.forEach(function(m){
        var vid = m.videoId || (m.url || '').match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/)?.[1] || '';
        var title = esc(m.title || 'music');
        list.innerHTML += '<div class="flex items-center justify-between p-3 bg-[#111113] border border-[#1E1E22] rounded-xl mt-2"><span class="font-body-md">'+title+'</span><div class="flex gap-2"><button class="px-3 py-1.5 bg-primary-container text-on-primary-container rounded-lg text-sm font-bold" onclick="downloadMusic(\''+vid+'\',\''+title.replace(/'/g,"")+'\',this)">Download</button><button class="px-3 py-1.5 border border-outline-variant rounded-lg text-sm" onclick="sendMusic(\''+vid+'\',\''+title.replace(/'/g,"")+'\',this)">Send</button></div></div>';
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
      var d = await r.json();
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
      var data = await r.json();
      if (!Array.isArray(data)) return;
      var list = $('#sources-list'); if (list) {
        list.innerHTML = '';
        data.forEach(function(s){
          list.innerHTML += '<div class="flex items-center justify-between p-3 bg-[#111113] border border-[#1E1E22] rounded-xl mt-2"><div><p class="font-body-md font-bold">'+esc(s.name)+'</p><p class="text-on-surface-variant text-sm">'+esc(s.url?.substring(0,40))+'</p></div><button class="text-error text-sm px-3 py-1 border border-error/30 rounded-lg" onclick="deleteSource('+s.id+')">Delete</button></div>';
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
    var lang = $('#set-lang')?.value || 'uz';
    var ch = $('#set-channel')?.value || '';
    var kw = $('#set-keywords')?.value || '';
    var interval = Math.max(1, Math.min(1440, parseInt($('#set-interval')?.value || '15', 10) || 15));
    var digest = $('#set-digest')?.value === 'true';
    var digestTime = $('#set-digest-time')?.value || '09:00';
    try {
      var r = await apiFetch('/api/settings/'+userId+'/extended', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ language:lang, target_channel:ch, keywords:kw, interval_minutes:interval, daily_digest:digest, digest_time:digestTime }) });
      if (r.ok) { showToast('Saved!','success'); }
      else { var e = await r.json(); showToast(e.error||'Error','error'); }
    } catch(e) { showToast('Error','error'); }
  };

  window.removeMainChannel = async function () {
    if (!confirm('Kanalni olib tashlaysizmi?')) return;
    try {
      var r = await apiFetch('/api/settings/'+userId+'/extended', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ target_channel:'' }) });
      if (r.ok) { $('#set-channel').value=''; showToast('Kanal olib tashlandi','success'); }
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
      var data = await r.json();
      var list = $('#channels-list'); if (!list) return;
      list.innerHTML = '';
      if (!Array.isArray(data) || !data.length) { list.innerHTML = '<p class="text-on-surface-variant">Kanal yo\'q</p>'; return; }
      data.forEach(function(ch){
        list.innerHTML += '<div class="flex items-center justify-between p-3 bg-[#111113] border border-[#1E1E22] rounded-xl mt-2"><span class="font-body-md">'+esc(ch.channel_username||ch.channel_id)+'</span><button class="text-error text-sm px-3 py-1 border border-error/30 rounded-lg" onclick="removeChannel('+ch.id+')">Remove</button></div>';
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
      var d = await r.json();
      setText('.btc-price', '$' + (d.btc || '—'));
      setText('.usd-price', (d.usd || '—') + ' so\'m');
    } catch(e) {}
  };

  // ─── Premium / Wallet ─────────────────────
  window.loadPremium = async function () {
    try {
      var r = await apiFetch('/api/premium-info');
      var d = await r.json();
      if (d) {
        setText('.wallet-status', d.is_premium ? 'Premium Active' : 'Free');
        setText('.wallet-plan', d.plan || '—');
        setText('.wallet-expiry', d.premium_until ? new Date(d.premium_until).toLocaleDateString() : '—');
        setText('.premium-badge', d.is_premium ? 'PREMIUM' : 'FREE');
      }
    } catch(e) {}
    try {
      var p = await apiFetch('/api/payments/methods');
      var m = await p.json();
      var container = $('#payment-methods');
      if (container) {
        container.innerHTML = '';
        [['stars','Stars','⭐'], ['usdt','USDT (TRC-20)','💎'], ['ton','TON','💎']].forEach(function(item){
          var btn = document.createElement('button');
          btn.className = 'px-4 py-2 border border-outline-variant rounded-lg text-sm hover:bg-surface-container ' + (window.__payMethod==item[0]?'bg-primary-container text-on-primary-container':'');
          btn.textContent = item[1] + (m[item[0]] ? '' : ' (—)');
          btn.onclick = function(){ window.__payMethod=item[0]; $$('#payment-methods button').forEach(function(b){b.className='px-4 py-2 border border-outline-variant rounded-lg text-sm hover:bg-surface-container';}); btn.className='px-4 py-2 border border-outline-variant rounded-lg text-sm bg-primary-container text-on-primary-container'; };
          container.appendChild(btn);
        });
      }
    } catch(e) {}
  };

  window.buyPremium = async function (period) {
    try {
      var r = await apiFetch('/api/premium/buy', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ period:period, method:window.__payMethod||'stars' }) });
      var d = await r.json();
      if (d.url) window.open(d.url, '_blank');
      else if (d.success) showToast('Premium aktiv!','success');
      else showToast(d.error||'Xatolik','error');
    } catch(e) { showToast('Xatolik','error'); }
  };

  // ─── Admin ─────────────────────────────────
  window.loadAdminUsers = async function () {
    try {
      var r = await apiFetch('/api/admin/users');
      var data = await r.json();
      if (!Array.isArray(data)) return;
      var list = $('#admin-users-list'); if (!list) return;
      list.innerHTML = '';
      data.forEach(function(u){
        list.innerHTML += '<div class="bg-[#111113] border border-[#1E1E22] rounded-xl p-stack-md mt-2"><div class="flex justify-between items-center"><div><p class="font-body-md font-bold">'+esc(u.first_name||u.username||u.telegram_id)+'</p><p class="text-on-surface-variant text-sm">ID: '+u.telegram_id+' | '+(u.role||'user')+' | '+(u.is_premium?'Premium':'Free')+'</p></div><div class="flex gap-2 flex-wrap">'+(u.is_approved?'':'<button class="px-2 py-1 bg-secondary-container/10 text-secondary rounded text-xs" onclick="adminUserAction('+u.telegram_id+',\'approve\')">Approve</button>')+'<button class="px-2 py-1 border border-error/30 text-error rounded text-xs" onclick="adminUserAction('+u.telegram_id+',\'block\')">Block</button>'+(u.is_premium?'<button class="px-2 py-1 border border-error/30 text-error rounded text-xs" onclick="adminUserAction('+u.telegram_id+',\'revoke\')">Revoke</button>':'<button class="px-2 py-1 bg-primary-container/10 text-primary rounded text-xs" onclick="adminUserAction('+u.telegram_id+',\'premium\')">Premium</button>')+'</div></div></div>';
      });
    } catch(e) {}
  };

  window.adminUserAction = async function (tid, action) {
    var urls = { approve:'/api/admin/users/'+tid+'/approve', block:'/api/admin/users/'+tid+'/block', unblock:'/api/admin/users/'+tid+'/unblock', reject:'/api/admin/users/'+tid+'/reject', premium:'/api/admin/users/'+tid+'/premium', revoke:'/api/admin/users/'+tid+'/premium' };
    var url = urls[action]; if (!url) return;
    var body = (action==='premium'||action==='revoke') ? JSON.stringify({ days: action==='revoke' ? 0 : 30 }) : undefined;
    try {
      var r = await apiFetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:body });
      if (r.ok) { showToast('OK','success'); loadAdminUsers(); }
      else showToast('Error','error');
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
      var d = await r.json();
      if ($('#premium-stars')) $('#premium-stars').value = d.premium_stars_price || '500';
      if ($('#premium-monthly')) $('#premium-monthly').value = d.premium_monthly_price || '25000';
      if ($('#premium-yearly')) $('#premium-yearly').value = d.premium_yearly_price || '250000';
      if ($('#require-approval')) $('#require-approval').checked = d.require_approval !== false;
    } catch(e) {}
  };

  window.loadSystemStatus = async function () {
    try {
      var r = await apiFetch('/api/admin/system');
      var d = await r.json();
      if (d) {
        setText('.sys-uptime', Math.floor((d.uptime||0)/3600)+' soat');
        setText('.sys-version', d.version||'—');
        setText('.sys-memory', d.memory_usage||'—');
        setText('.sys-node', d.nodeVersion||'—');
        setText('.sys-redis', d.redis ? 'Online' : 'Offline');
      }
    } catch(e) {}
  };

  // ─── Auto-init based on data-page ──────────
  var page = document.body?.getAttribute('data-page');
  if (page === 'sources') { loadSources(); }
  if (page === 'distribution') { loadChannels(); }
  if (page === 'wallet') { loadPremium(); }
  if (page === 'admin-users' || page === 'admin-users-approvals') { loadAdminUsers(); }
  if (page === 'admin-system' || page === 'admin-overview') { loadSystemStatus(); }
  if (page === 'admin-system-config') { loadAdminSettings(); }
  if (page === 'analytics') { loadFinance(); }

  // Backward-compat for old SPA-style onclick
  window.$ = $;
  window.$$= $$;
})();
