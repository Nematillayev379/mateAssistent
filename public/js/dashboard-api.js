(function () {
  var token, userId;

  function getParam(name) {
    var match = window.location.search.match(new RegExp('[?&]' + name + '=([^&]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getLocal(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function setLocal(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
  }

  // Try to get from URL params first
  token = getParam('token');
  userId = getParam('user');

  // If not in URL, try localStorage
  if (!token) token = getLocal('bot_token');
  if (!userId) userId = getLocal('bot_user_id');

  // If still no userId, try Telegram WebApp
  if (!userId && window.Telegram && window.Telegram.WebApp) {
    try {
      var tg = window.Telegram.WebApp;
      if (tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.id) {
        userId = String(tg.initDataUnsafe.user.id);
      }
    } catch (e) {}
  }

  // Save to localStorage if we got them from URL
  if (token && getParam('token')) setLocal('bot_token', token);
  if (userId && getParam('user')) setLocal('bot_user_id', userId);

  window.__userLang = getLocal('webapp_lang') || 'uz';
  window.__token = token;
  window.__userId = userId;
  window.__apiBase = '';

  window.apiFetch = function (resource, opts) {
    opts = opts || {};
    var h = {};
    h['x-bot-token'] = token;
    if (userId) h['x-user-id'] = userId;
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (k) { h[k] = opts.headers[k]; });
    }
    var merged = {};
    Object.keys(opts).forEach(function (k) { if (k !== 'headers') merged[k] = opts[k]; });
    merged.headers = h;
    return fetch(window.__apiBase + resource, merged);
  };

  window.showToast = function (msg, type) {
    type = type || 'info';
    var t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3000);
  };

  // Auto-login: if we have userId but no token, generate one
  if (userId && !token) {
    var secret = '2d5b291fb6d65429eac3562da57884dab8677f3522780d87a9cb4fe54f473546';
    var encoder = new TextEncoder();
    var data = encoder.encode(userId + ':' + secret);
    crypto.subtle.digest('SHA-256', data).then(function(hashBuffer) {
      var hashArray = Array.from(new Uint8Array(hashBuffer));
      token = hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, 32);
      window.__token = token;
      setLocal('bot_token', token);
    });
  }
})();
