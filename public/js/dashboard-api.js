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

  token = getParam('token') || getLocal('bot_token');
  userId = getParam('user') || getLocal('bot_user_id');
  window.__userLang = getLocal('webapp_lang') || 'uz';

  if (token && getParam('token')) setLocal('bot_token', token);
  if (userId && getParam('user')) setLocal('bot_user_id', userId);

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
})();
