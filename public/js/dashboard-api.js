(function () {
  var params = new URLSearchParams(window.location.search);
  var token = params.get('token') || localStorage.getItem('bot_token');
  var userId = params.get('user') || localStorage.getItem('bot_user_id');

  if (token && params.has('token')) localStorage.setItem('bot_token', token);
  if (userId && params.has('user')) localStorage.setItem('bot_user_id', userId);

  window.__token = token;
  window.__userId = userId;
  window.__apiBase = '';

  window.apiFetch = function (resource, opts) {
    opts = opts || {};
    var headers = { 'x-bot-token': token, ...(opts.headers || {}) };
    if (userId) headers['x-user-id'] = userId;
    return fetch(window.__apiBase + resource, { ...opts, headers });
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
