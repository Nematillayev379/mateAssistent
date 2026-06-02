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

function tt(key, fallback) {
    if (typeof t === 'function') {
        var value = t(key);
        if (value && value !== key) return value;
    }
    return fallback || key;
}

function $(selector) {
    var els = document.querySelectorAll(selector);
    if (els.length <= 1) return els[0];
    return Array.from(els).find(function (el) {
        return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
    }) || els[0];
}

async function generateAIPost() {
    var prompt = $('#ai-prompt')?.value;
    if (!prompt) { showToast(tt('search_query_required', 'Please enter a search term.'), 'error'); return; }
    var btn = $('#btn-ai');
    var originalInnerHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = $('#ai-image')?.checked
        ? '<i class="fas fa-spinner fa-spin"></i> ' + tt('loading', 'Loading...') + '...'
        : '<i class="fas fa-spinner fa-spin"></i> ' + tt('loading', 'Loading...') + '...';
    try {
        var language = $('#post-lang')?.value || userData?.user?.language || 'uz';
        var size = $('#ai-size')?.value || 'medium';
        var res = await apiFetch('/api/ai/smm', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ prompt: prompt, language: language, size: size, withImage: !!$('#ai-image')?.checked }) });
        if (!res.ok) { var error = await res.json(); throw new Error(error.error || tt('common_error', 'An error occurred')); }
        var data = await res.json();
        if (!data.text || data.text.length < 10) throw new Error(tt('ai_post_not_generated', 'AI post was not generated. Check your API keys (GROQ/GEMINI).'));
        $('#ai-result').style.display = 'block';
        $('#ai-res-text').textContent = data.text;
        var copyBtn = $('#ai-copy-btn');
        if (copyBtn) copyBtn.style.display = 'inline-block';
        var img = $('#ai-res-img');
        window.lastSmmImageBase64 = data.imageBase64 || null;
        var imgSrc = data.imageBase64 || data.imageUrl;
        if (imgSrc) {
            img.onload = function () { img.style.display = 'block'; };
            img.onerror = function () { img.style.display = 'none'; if (data.imageUrl && data.imageUrl !== imgSrc) { img.src = data.imageUrl; img.style.display = 'block'; } };
            img.src = imgSrc;
            img.style.display = 'block';
        } else { img.style.display = 'none'; }
    } catch (error) { showToast(tt('common_error', 'An error occurred') + ': ' + error.message, 'error'); $('#ai-result').style.display = 'none'; }
    finally { btn.disabled = false; btn.innerHTML = originalInnerHTML; }
}

function copyAIPostText() {
    var text = $('#ai-res-text').textContent;
    navigator.clipboard.writeText(text).then(function () { showToast(tt('common_copied', 'Link copied!'), 'success'); }).catch(function () { showToast(tt('common_error', 'An error occurred'), 'error'); });
}

async function sendAIPostToChannel() {
    var text = $('#ai-res-text').textContent;
    var img = $('#ai-res-img');
    var prompt = $('#ai-prompt')?.value || '';
    var imageBase64 = img.style.display === 'block' && img.src?.startsWith('data:') ? img.src : window.lastSmmImageBase64;
    var imageUrl = img.style.display === 'block' && img.src?.startsWith('http') ? img.src : null;
    if (!text) return;
    var btn = $('#btn-send-ai');
    btn.disabled = true;
    try {
        var res = await apiFetch('/api/ai/post-to-channel', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ text: text, prompt: prompt, imageUrl: imageUrl, imageBase64: imageBase64 }) });
        if (res.ok) showToast(tt('bot_media_sent_channel', 'Media was sent to your channel.'), 'success'); else showToast(tt('common_error', 'An error occurred'), 'error');
    } catch (e) { showToast(tt('common_error', 'An error occurred') + ': ' + e.message, 'error'); }
    finally { btn.disabled = false; }
}

async function searchMusic() {
    var q = $('#music-q').value;
    if (!q) return;
    var list = $('#music-list'); list.innerHTML = '<p>' + tt('loading', 'Qidirilmoqda...') + '</p>';
    var res = await apiFetch('/api/music/search?q=' + encodeURIComponent(q), { headers: { 'x-bot-token': token } });
    var data = await res.json();
    list.innerHTML = '';
    if (!data.length) { list.innerHTML = '<p style="color:var(--secondary)">' + tt('no_results', 'Natija topilmadi') + '</p>'; return; }
    data.forEach(function (m) {
        var safeTitle = (m.title || 'music').replace(/'/g, '');
        list.innerHTML += '<div class="item-row" style="flex-wrap: wrap;"><div><h4>' + escapeHtml(m.title || '') + '</h4></div><div style="display:flex;gap:6px;"><button class="btn btn-primary" style="width:auto; padding:8px 12px;" onclick="downloadMusic(\'' + (m.videoId || extractYouTubeId(m.url)) + '\', \'' + safeTitle + '\', this)"><i class="fas fa-download"></i></button><button class="btn btn-ghost" style="width:auto; padding:8px 12px;" onclick="sendMusic(\'' + (m.videoId || extractYouTubeId(m.url)) + '\', \'' + safeTitle + '\', this)"><i class="fas fa-paper-plane"></i></button></div></div>';
    });
}

async function downloadMusic(videoId, title, btnEl) {
    var id = extractYouTubeId(videoId);
    if (!id) { showToast(tt('music_video_id_missing', 'Video ID not found'), 'error'); return; }
    var btn = btnEl || event?.target?.closest('button');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    try {
        var res = await apiFetch('/api/music/download/' + id + '?web=1', { headers: { 'x-bot-token': token } });
        if (!res.ok) { var err = await res.json().catch(function () { return {}; }); throw new Error(err.error || tt('media_download_failed', 'Media download failed')); }
        var blob = await res.blob();
        var ext = getExtensionFromContentType(res.headers.get('content-type'), 'm4a');
        triggerBrowserDownload(blob, (title || 'music') + '.' + ext);
    } catch (e) { showToast(tt('common_error', 'An error occurred') + ': ' + e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-download"></i>'; } }
}

async function sendMusic(videoId, title, btnEl) {
    var id = extractYouTubeId(videoId);
    if (!id) { showToast(tt('music_video_id_missing', 'Video ID not found'), 'error'); return; }
    var btn = btnEl || event?.target?.closest('button');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; }
    try {
        var res = await apiFetch('/api/music/download/' + id + '?send=1', { headers: { 'x-bot-token': token } });
        if (!res.ok) { var err = await res.json().catch(function () { return {}; }); throw new Error(err.error || tt('music_download_failed', 'Music download failed')); }
        var data = await res.json();
        if (data.success) { showToast(data.message || tt('music_sent_to_channel', 'Music sent to channel!'), 'success'); }
        else { throw new Error(data.error || tt('music_download_failed', 'Music download failed')); }
    } catch (e) { showToast(tt('common_error', 'An error occurred') + ': ' + e.message, 'error'); }
    finally { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane"></i>'; } }
}

async function downloadM(videoId, title, btnEl) { return downloadMusic(videoId, title, btnEl); }
async function downloadAndSendMusic(videoId, title, btnEl) { return sendMusic(videoId, title, btnEl); }

async function downloadMedia(type, btnEl) {
    var url = $('#dl-url').value.trim();
    if (!url) { showToast(tt('video_download_hint', 'Share a YouTube, Instagram, or TikTok link.'), 'error'); return; }
    var videoBtn = $('#btn-dl-video');
    var audioBtn = $('#btn-dl-audio');
    var originalBtn = btnEl?.innerHTML;
    if (videoBtn) videoBtn.disabled = true;
    if (audioBtn) audioBtn.disabled = true;
    if (btnEl) btnEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + tt('loading', 'Loading...');
    var ext = type === 'video' ? 'mp4' : 'm4a';
    try {
        var res = await apiFetch('/api/media/download?web=1', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-bot-token': token }, body: JSON.stringify({ url: url, type: type, delivery: 'web' }) });
        if (!res.ok) { var err = await res.json().catch(function () { return {}; }); throw new Error(err.error || tt('media_download_failed', 'Media download failed')); }
        var contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) { var err = await res.json(); throw new Error(err.error || tt('server_error', 'Server error')); }
        var blob = await res.blob();
        if (blob.size < 1000) throw new Error(tt('media_download_failed', 'Media download failed'));
        triggerBrowserDownload(blob, 'media_' + Date.now() + '.' + ext);
    } catch (e) { showToast(tt('common_error', 'An error occurred') + ': ' + e.message, 'error'); }
    finally {
        if (videoBtn) videoBtn.disabled = false;
        if (audioBtn) audioBtn.disabled = false;
        if (btnEl) btnEl.innerHTML = originalBtn;
    }
}

async function generateVoiceNews() {
    var status = $('#voice-status');
    var title = $('#voice-title')?.value?.trim() || '';
    var text = $('#voice-text')?.value?.trim() || '';
    if (!title && !text) { showToast(tt('voice_news_empty', 'Please enter a title or text.'), 'error'); if (status) status.textContent = tt('voice_news_empty', 'Please enter a title or text.'); return; }
    if (status) status.textContent = tt('loading', 'Loading...');
    try {
        var res = await apiFetch('/api/ai/voice-news', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title, text: text, sendToChannel: !!$('#voice-to-channel')?.checked }) });
        var data = await res.json();
        if (res.ok) { if (status) status.textContent = tt('bot_media_sent_channel', 'Media was sent to your channel.'); showToast(tt('bot_media_sent_channel', 'Media was sent to your channel.'), 'success'); }
        else { if (status) status.textContent = data.error || tt('common_error', 'An error occurred'); showToast(data.error || tt('voice_generation_failed', 'Voice generation failed'), 'error'); }
    } catch (e) { if (status) status.textContent = tt('common_error', 'An error occurred'); showToast(tt('common_error', 'An error occurred') + ': ' + (e.message || e), 'error'); }
}

(function() {
    var musicInput = $('#music-q');
    if (musicInput) {
        musicInput.placeholder = tt('music_search_placeholder', musicInput.placeholder || 'Artist or song...');
        musicInput.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') searchMusic();
        });
    }
})();
