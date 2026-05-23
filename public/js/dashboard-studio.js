/* Studio JS — lazy loaded when Studio page is opened */
function extractYouTubeId(urlOrId) {
    if (!urlOrId) return '';
    if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;
    var m = String(urlOrId).match(/(?:v=|\/)([a-zA-Z0-9_-]{11})(?:[&?#/]|$)/);
    return m ? m[1] : '';
}

function triggerBrowserDownload(blob, filename) {
    var a = document.createElement('a');
    var href = URL.createObjectURL(blob);
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(href); }, 2000);
}

function getExtensionFromContentType(contentType, fallbackExt) {
    var value = String(contentType || '').toLowerCase();
    if (value.indexOf('audio/mpeg') >= 0) return 'mp3';
    if (value.indexOf('audio/mp4') >= 0 || value.indexOf('audio/x-m4a') >= 0) return 'm4a';
    if (value.indexOf('audio/webm') >= 0) return 'webm';
    if (value.indexOf('video/mp4') >= 0) return 'mp4';
    return fallbackExt;
}

async function generateAIPost() {
    var prompt = document.getElementById('ai-prompt').value;
    if (!prompt) { showToast('Iltimos mavzu kiriting!', 'error'); return; }
    var btn = document.getElementById('btn-ai');
    var originalInnerHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = document.getElementById('ai-image').checked
        ? '<i class="fas fa-spinner fa-spin"></i> Matn va rasm tayyorlanmoqda...'
        : '<i class="fas fa-spinner fa-spin"></i> Matn tayyorlanmoqda...';
    try {
        var language = document.getElementById('post-lang')?.value || userData?.user?.language || 'uz';
        var res = await apiFetch('/api/ai/smm', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ prompt: prompt, language: language, withImage: document.getElementById('ai-image').checked }) });
        if (!res.ok) { var error = await res.json(); throw new Error(error.error || 'Xatolik yuz berdi'); }
        var data = await res.json();
        if (!data.text || data.text.length < 10) throw new Error('AI post yaratmadi. API kalitlarini tekshiring (GROQ/GEMINI).');
        document.getElementById('ai-result').style.display = 'block';
        document.getElementById('ai-res-text').textContent = data.text;
        var copyBtn = document.getElementById('ai-copy-btn');
        if (copyBtn) copyBtn.style.display = 'inline-block';
        var img = document.getElementById('ai-res-img');
        window.lastSmmImageBase64 = data.imageBase64 || null;
        var imgSrc = data.imageBase64 || data.imageUrl;
        if (imgSrc) {
            img.onload = function () { img.style.display = 'block'; };
            img.onerror = function () { img.style.display = 'none'; if (data.imageUrl && data.imageUrl !== imgSrc) { img.src = data.imageUrl; img.style.display = 'block'; } };
            img.src = imgSrc;
            img.style.display = 'block';
        } else { img.style.display = 'none'; }
    } catch (error) { showToast('Xatolik: ' + error.message, 'error'); document.getElementById('ai-result').style.display = 'none'; }
    finally { btn.disabled = false; btn.innerHTML = originalInnerHTML; }
}

function copyAIPostText() {
    var text = document.getElementById('ai-res-text').textContent;
    navigator.clipboard.writeText(text).then(function () { showToast('Post matni nusxalandi!', 'success'); }).catch(function () { showToast('Nusxalash muvaffaqiyatsiz', 'error'); });
}

async function sendAIPostToChannel() {
    var text = document.getElementById('ai-res-text').textContent;
    var img = document.getElementById('ai-res-img');
    var imageBase64 = img.style.display === 'block' && img.src?.startsWith('data:') ? img.src : window.lastSmmImageBase64;
    var imageUrl = img.style.display === 'block' && img.src?.startsWith('http') ? img.src : null;
    if (!text) return;
    var btn = document.getElementById('btn-send-ai');
    btn.disabled = true;
    try {
        var res = await apiFetch('/api/ai/post-to-channel', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ text: text, imageUrl: imageUrl, imageBase64: imageBase64 }) });
        if (res.ok) showToast('Post kanalga yuborildi!', 'success'); else showToast('Xatolik yuz berdi', 'error');
    } catch (e) { showToast(e.message, 'error'); }
    finally { btn.disabled = false; }
}

async function searchMusic() {
    var q = document.getElementById('music-q').value;
    if (!q) return;
    var list = document.getElementById('music-list'); list.innerHTML = '<p>Qidirilmoqda...</p>';
    var res = await apiFetch('/api/music/search?q=' + encodeURIComponent(q), { headers: { 'x-bot-token': token } });
    var data = await res.json();
    list.innerHTML = '';
    if (!data.length) { list.innerHTML = '<p style="color:var(--secondary)">Natija topilmadi</p>'; return; }
    data.forEach(function (m) {
        var safeTitle = (m.title || 'music').replace(/'/g, '');
        list.innerHTML += '<div class="item-row" style="flex-wrap: wrap;"><div><h4>' + escapeHtml(m.title || '') + '</h4></div><div style="display:flex;gap:6px;"><button class="btn btn-primary" style="width:auto; padding:8px 12px;" onclick="downloadM(\'' + (m.videoId || extractYouTubeId(m.url)) + '\', \'' + safeTitle + '\', this)"><i class="fas fa-download"></i></button><button class="btn btn-ghost" style="width:auto; padding:8px 12px;" onclick="downloadAndSendMusic(\'' + (m.videoId || extractYouTubeId(m.url)) + '\', \'' + safeTitle + '\', this)"><i class="fas fa-paper-plane"></i></button></div></div>';
    });
}

async function downloadM(videoId, title, btnEl) {
    var id = extractYouTubeId(videoId);
    if (!id) { showToast('Video ID topilmadi', 'error'); return; }
    var btn = btnEl || event?.target?.closest('button');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    try {
        var res = await apiFetch('/api/music/download/' + id + '?web=1', { headers: { 'x-bot-token': token } });
        if (!res.ok) { var err = await res.json().catch(function () { return {}; }); throw new Error(err.error || 'Yuklab olish muvaffaqiyatsiz'); }
        var blob = await res.blob();
        var ext = getExtensionFromContentType(res.headers.get('content-type'), 'm4a');
        triggerBrowserDownload(blob, (title || 'music') + '.' + ext);
    } catch (e) { showToast('Xatolik: ' + e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i>'; } }
}

async function downloadAndSendMusic(videoId, title, btnEl) {
    var id = extractYouTubeId(videoId);
    if (!id) { showToast('Video ID topilmadi', 'error'); return; }
    var btn = btnEl || event?.target?.closest('button');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    try {
        var res = await apiFetch('/api/music/download/' + id + '?send=1', { headers: { 'x-bot-token': token } });
        if (!res.ok) { var err = await res.json().catch(function () { return {}; }); throw new Error(err.error || 'Yuklab olish muvaffaqiyatsiz'); }
        var data = await res.json();
        if (data.success) { showToast(data.message || 'Musiqa kanalga yuborildi!', 'success'); }
        else { throw new Error(data.error || 'Yuborish muvaffaqiyatsiz'); }
    } catch (e) { showToast('Xatolik: ' + e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i>'; } }
}

async function downloadMedia(type, btnEl) {
    var url = document.getElementById('dl-url').value.trim();
    if (!url) { showToast('Iltimos havola kiriting', 'error'); return; }
    var videoBtn = document.getElementById('btn-dl-video');
    var audioBtn = document.getElementById('btn-dl-audio');
    var originalBtn = btnEl?.innerHTML;
    if (videoBtn) videoBtn.disabled = true;
    if (audioBtn) audioBtn.disabled = true;
    if (btnEl) btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Yuklanmoqda...';
    var ext = type === 'video' ? 'mp4' : 'm4a';
    try {
        var res = await apiFetch('/api/media/download?web=1', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ url: url, type: type, delivery: 'web' }) });
        if (!res.ok) { var err = await res.json().catch(function () { return {}; }); throw new Error(err.error || 'Yuklab olish muvaffaqiyatsiz'); }
        var contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) { var err = await res.json(); throw new Error(err.error || 'Server xatosi'); }
        var blob = await res.blob();
        if (blob.size < 1000) throw new Error('Fayl juda kichik yuklash muvaffaqiyatsiz');
        triggerBrowserDownload(blob, 'media_' + Date.now() + '.' + ext);
    } catch (e) { showToast('Xatolik: ' + e.message, 'error'); }
    finally {
        if (videoBtn) videoBtn.disabled = false;
        if (audioBtn) audioBtn.disabled = false;
        if (btnEl) btnEl.innerHTML = originalBtn;
    }
}

async function generateVoiceNews() {
    var status = document.getElementById('voice-status');
    var title = document.getElementById('voice-title')?.value?.trim() || '';
    var text = document.getElementById('voice-text')?.value?.trim() || '';
    if (!title && !text) { showToast('Sarlavha yoki matn kiriting', 'error'); if (status) status.textContent = 'Sarlavha yoki matn kiriting'; return; }
    if (status) status.textContent = 'Generatsiya...';
    try {
        var res = await apiFetch('/api/ai/voice-news', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title, text: text, sendToChannel: document.getElementById('voice-to-channel')?.checked }) });
        var data = await res.json();
        if (res.ok) { if (status) status.textContent = 'Audio yuborildi'; showToast('Audio yuborildi', 'success'); }
        else { if (status) status.textContent = data.error || 'Xatolik'; showToast(data.error || 'Ovoz generatsiyasi xatosi', 'error'); }
    } catch (e) { if (status) status.textContent = 'Aloqa xatosi'; showToast('Aloqa xatosi: ' + (e.message || e), 'error'); }
}

(function() {
    var musicInput = document.getElementById('music-q');
    if (musicInput) {
        musicInput.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') searchMusic();
        });
    }
})();
