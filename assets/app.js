// FaceTalk v2 前端：双向互选流程
(function () {
  'use strict';
  var me = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); }
  function modeLabel(m) { return m === 'video' ? '📹 视频' : '🎙 语音优先'; }

  function toast(msg, isErr) {
    var el = document.createElement('div');
    el.className = 'toast' + (isErr ? ' toast-err' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 10);
    setTimeout(function () { el.classList.remove('show'); setTimeout(function(){ el.remove(); }, 300); }, 2600);
  }

  async function rawGet(path) {
    var res = await fetch(path, { method: 'GET' });
    var d = {}; try { d = await res.json(); } catch (e) {}
    return { status: res.status, data: d };
  }

  // 带 token 的 API；GET 走 query，POST 走 body
  async function api(method, path, body) {
    var url = new URL(path, location.origin);
    if (method === 'GET') url.searchParams.set('me', me);
    var opt = { method: method, headers: {} };
    if (body) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(Object.assign({ me: me }, body)); }
    var res = await fetch(url, opt);
    var d = {}; try { d = await res.json(); } catch (e) {}
    if (res.status === 503 && d.error === 'KV_NOT_BOUND') toast('后端存储正在初始化：请在 Cloudflare 绑定 KV（变量名 DAZI_KV）', true);
    else if (res.status === 403 && d.error === 'BANNED') toast('该身份已被封禁', true);
    else if (res.status === 401 && d.error === 'BAD_TOKEN') { localStorage.removeItem('ft_me'); location.reload(); }
    return { status: res.status, data: d };
  }

  async function ensureToken() {
    me = localStorage.getItem('ft_me');
    if (me) {
      var r = await rawGet('/api/identity?id=' + encodeURIComponent(me));
      if (r.status === 200 && !r.data.banned) return;
    }
    var res = await fetch('/api/identity', { method: 'POST' });
    var d = {}; try { d = await res.json(); } catch (e) {}
    me = d.id;
    localStorage.setItem('ft_me', me);
  }

  function renderRep() {
    if (!me) return;
    rawGet('/api/identity?id=' + encodeURIComponent(me)).then(function (r) {
      if (r.status === 200) $('my-rep').textContent = r.data.rep;
    });
  }

  // 发布意图
  $('intent-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var body = {
      role: $('i-role').value, city: $('i-city').value.trim(),
      mode: $('i-mode').value, meet: $('i-meet').value.trim(), note: $('i-note').value.trim(),
    };
    var r = await api('POST', '/api/intents', body);
    if (r.status === 200 && r.data.ok) {
      toast('意图已发布，等搭子来申请 🎉');
      $('i-city').value = ''; $('i-meet').value = ''; $('i-note').value = '';
      loadBrowse(); loadInbox();
    } else {
      toast('发布失败：' + (r.data.error || r.status), true);
    }
  });

  // 浏览
  async function loadBrowse() {
    var r = await api('GET', '/api/intents');
    var box = $('browse-list'); box.innerHTML = '';
    if (r.status === 200 && r.data.list && r.data.list.length) {
      $('browse-empty').hidden = true;
      r.data.list.forEach(function (it) {
        var div = document.createElement('div'); div.className = 'li';
        div.innerHTML = '<div class="li-main"><span class="tag">' + esc(it.role) + '</span>' +
          (it.city ? ' <span class="muted">' + esc(it.city) + '</span>' : '') +
          ' <span class="mode">' + modeLabel(it.mode) + '</span></div>' +
          (it.note ? '<p class="li-note">' + esc(it.note) + '</p>' : '') +
          '<div class="li-foot"><span class="rep">⭐ ' + (it.rep != null ? it.rep : '50') + '</span>' +
          '<button class="btn-mini" data-apply="' + esc(it.id) + '">申请组队</button></div>';
        box.appendChild(div);
      });
      box.querySelectorAll('[data-apply]').forEach(function (b) {
        b.addEventListener('click', async function () {
          var rr = await api('POST', '/api/apply', { intentId: b.getAttribute('data-apply') });
          if (rr.status === 200 && rr.data.ok) toast('已申请，等对方同意 ⏳');
          else toast('申请失败：' + (rr.data.error || rr.status), true);
          loadOut();
        });
      });
    } else { $('browse-empty').hidden = false; }
  }

  // 收到申请
  async function loadInbox() {
    var r = await api('GET', '/api/apply?box=in');
    var box = $('inbox-list'); box.innerHTML = '';
    if (r.status === 200 && r.data.list && r.data.list.length) {
      $('inbox-empty').hidden = true;
      r.data.list.forEach(function (a) {
        var div = document.createElement('div'); div.className = 'li';
        var decide = a.status === 'pending'
          ? '<button class="btn-mini ok" data-acc="' + esc(a.appId) + '">同意</button>' +
            '<button class="btn-mini no" data-rej="' + esc(a.appId) + '">拒绝</button>'
          : '<span class="muted">' + (a.status === 'accepted' ? '已同意' : '已拒绝') + '</span>';
        div.innerHTML = '<div class="li-main"><span class="tag">' + esc(a.role) + '</span>' +
          (a.city ? ' <span class="muted">' + esc(a.city) + '</span>' : '') +
          ' <span class="mode">' + modeLabel(a.mode) + '</span> <span class="rep">⭐' + (a.rep != null ? a.rep : '50') + '</span></div>' +
          (a.note ? '<p class="li-note">' + esc(a.note) + '</p>' : '') +
          '<div class="li-foot">' + decide + '</div>';
        box.appendChild(div);
      });
      box.querySelectorAll('[data-acc]').forEach(function (b) {
        b.addEventListener('click', function () { decide(b.getAttribute('data-acc'), 'accept'); });
      });
      box.querySelectorAll('[data-rej]').forEach(function (b) {
        b.addEventListener('click', function () { decide(b.getAttribute('data-rej'), 'reject'); });
      });
    } else { $('inbox-empty').hidden = false; }
  }

  async function decide(appId, decision) {
    var r = await api('POST', '/api/pair', { action: 'decide', appId: appId, decision: decision });
    if (r.status === 200 && r.data.ok) {
      toast(decision === 'accept' ? '已同意，搭子匹配成功 🤝' : '已拒绝');
      loadInbox(); checkPair();
    } else toast('操作失败：' + (r.data.error || r.status), true);
  }

  // 发出申请
  async function loadOut() {
    var r = await api('GET', '/api/apply?box=out');
    var box = $('out-list'); box.innerHTML = '';
    if (r.status === 200 && r.data.list && r.data.list.length) {
      $('out-empty').hidden = true;
      r.data.list.forEach(function (o) {
        var s = o.status === 'pending' ? '待对方同意' : (o.status === 'accepted' ? '已同意 ✓' : '已拒绝');
        var div = document.createElement('div'); div.className = 'li';
        div.innerHTML = '<div class="li-main"><span class="muted">申请 ' + esc(o.intentId) + '</span></div>' +
          '<div class="li-foot"><span class="muted">' + s + '</span></div>';
        box.appendChild(div);
      });
    } else { $('out-empty').hidden = false; }
  }

  // 配对状态
  async function checkPair() {
    var r = await api('GET', '/api/pair');
    var p = r.status === 200 ? r.data.pair : null;
    var rated = p && p.rated;
    if (p && !rated) {
      $('room-card').hidden = false;
      $('room-enter').href = '/pair.html?pair=' + encodeURIComponent(p.pairId);
      if (p.status === 'done' && !rated) $('rate-card').hidden = false; else $('rate-card').hidden = true;
    } else {
      $('room-card').hidden = true; $('rate-card').hidden = true;
    }
  }

  // 互评
  $('rate-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var p = (await api('GET', '/api/pair')).data.pair;
    if (!p) return;
    var r = await api('POST', '/api/pair', {
      action: 'rate', pairId: p.pairId,
      score: parseInt($('r-score').value, 10),
      tags: $('r-tags').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 5),
      next: $('r-next').checked,
    });
    if (r.status === 200 && r.data.ok) {
      toast('评价已提交，感谢互评 ⭐');
      $('rate-card').hidden = true;
      renderRep();
    } else toast('评价失败：' + (r.data.error || r.status), true);
  });

  $('browse-refresh').addEventListener('click', loadBrowse);

  async function boot() {
    try { await ensureToken(); } catch (e) { toast('无法获取身份，请稍后重试', true); }
    renderRep();
    loadBrowse(); loadInbox(); loadOut(); checkPair();
    setInterval(function () { loadBrowse(); loadInbox(); loadOut(); checkPair(); renderRep(); }, 15000);
  }
  boot();
})();
