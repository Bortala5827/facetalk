// FaceTalk 全站公开留言墙前端（自包含，配合 /api/wall）
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var BASE = '';
  var prevSig = ''; // 上一次列表签名，轮询无变化时跳过重绘，避免每 30s 闪动

  function avatarFor(name) {
    var s = (name || '匿').trim();
    var ch = s ? s.charAt(0) : '匿';
    var grads = [
      'linear-gradient(135deg,#1e88e5,#42a5f5)',
      'linear-gradient(135deg,#06b6d4,#22d3ee)',
      'linear-gradient(135deg,#7c3aed,#a78bfa)',
      'linear-gradient(135deg,#10b981,#34d399)',
      'linear-gradient(135deg,#f59e0b,#fbbf24)',
      'linear-gradient(135deg,#ec4899,#f472b6)'
    ];
    var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return { ch: ch, bg: grads[h % grads.length] };
  }

  function timeAgo(sec) {
    var d = Math.floor(Date.now() / 1000) - (sec || 0);
    if (d < 60) return '刚刚';
    if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
    if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
    return Math.floor(d / 86400) + ' 天前';
  }
  function esc(s) {
    return (s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showErr(msg) {
    var wall = $('#wall');
    if (!wall) return;
    var tip = $('#wallTip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'wallTip';
      tip.className = 'wall-tip-msg';
      wall.appendChild(tip);
    }
    tip.textContent = msg;
    tip.hidden = false;
    setTimeout(function () { if (tip) tip.hidden = true; }, 3200);
  }

  async function loadWall() {
    var list = $('#wallList');
    if (!list) return;
    try {
      var r = await fetch(BASE + '/api/wall', { cache: 'no-store' });
      var d = await r.json();
      if (!d.ok) { list.innerHTML = '<div class="wall-empty">留言墙暂不可用</div>'; return; }
      var items = d.items || [];
      if (!items.length) { list.innerHTML = '<div class="wall-empty">还没有留言，来抢沙发吧～</div>'; return; }
      var sig = items.map(function (it) { return it.id; }).join('|');
      if (sig === prevSig) return; // 列表无变化，跳过重绘（轮询去抖）
      prevSig = sig;
      // v2.4：最新 2 条常驻可见，旧留言收进 <details> 折叠
      var SHOW_RECENT = 2;
      var recent = items.slice(0, SHOW_RECENT);
      var older = items.slice(SHOW_RECENT);
      function renderItem(it) {
        var av = avatarFor(it.name || '匿名用户');
        return '<div class="wall-item" data-id="' + esc(it.id) + '">' +
          '<div class="wi-avatar" style="background:' + av.bg + '">' + esc(av.ch) + '</div>' +
          '<div class="wi-body">' +
            '<div class="wi-top"><span class="wi-name">' + esc(it.name || '匿名用户') + '</span>' +
            '<span class="wi-time">' + timeAgo(it.createdAt) + '</span></div>' +
            '<div class="wi-text">' + esc(it.text) + '</div>' +
          '</div>' +
          '<button class="wall-del" data-id="' + esc(it.id) + '" title="删除">✕</button>' +
          '</div>';
      }
      var html = recent.map(renderItem).join('');
      if (older.length > 0) {
        html += '<details class="wall-older"><summary class="wall-older-sum">查看更早的 ' + older.length + ' 条留言 ▾</summary>' +
          older.map(renderItem).join('') + '</details>';
      }
      list.innerHTML = html;
    } catch (e) {
      list.innerHTML = '<div class="wall-empty">网络异常，稍后重试</div>';
    }
  }

  async function postWall() {
    var nameEl = $('#wallName'), textEl = $('#wallText'), btn = $('#wallPost');
    if (!textEl || !btn) return;
    var text = (textEl.value || '').trim();
    if (!text) { showErr('写点内容再发布吧'); return; }
    // 前期（公开留言墙）严禁留个人微信 / 手机号：先在前端拦一道，避免绕过后端
    var contactHit = /微信|vx|v信|wechat|微信号|加我|私聊|1[3-9]\d{9}/i.test((nameEl.value || '') + ' ' + text);
    if (contactHit) { showErr('请勿在留言墙留个人微信或手机号，防骗'); return; }
    btn.disabled = true;
    try {
      var r = await fetch(BASE + '/api/wall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: (nameEl.value || '').trim(), text: text })
      });
      var d = await r.json();
      if (!d.ok) {
        if (d.error === 'RATE_LIMIT') showErr('太快啦，' + (d.left || 60) + ' 秒后再发');
        else if (d.error === 'DAILY_LIMIT') showErr('今日发帖已达上限，明天再来');
        else if (d.error === 'BAD_WORD') showErr('含违规词「' + (d.word || '') + '」，请修改');
        else if (d.error === 'DUP') showErr('这条好像刚发过');
        else if (d.error === 'EMPTY_TEXT') showErr('内容不能为空');
        else if (d.error === 'DB_NOT_BOUND') showErr('留言墙服务未就绪');
        else showErr('发布失败，请重试');
        btn.disabled = false;
        return;
      }
      textEl.value = '';
      await loadWall();
    } catch (e) {
      showErr('网络异常，发布失败');
    }
    btn.disabled = false;
  }

  async function deleteWall(id, key) {
    try {
      var k = String(key || '').trim();
      var r = await fetch(BASE + '/api/wall?id=' + encodeURIComponent(id) + '&admin=' + encodeURIComponent(k), { method: 'DELETE' });
      var d = await r.json();
      return !!(d && d.ok);
    } catch (e) { return false; }
  }

  function bind() {
    var post = $('#wallPost');
    if (post) post.addEventListener('click', postWall);

    var manage = $('#wallManage');
    var wallEl = $('#wall');
    if (manage) manage.addEventListener('click', function (e) {
      e.preventDefault();       // 阻止 <summary> 内的点击触发展开/收起
      e.stopPropagation();
      var on = manage.classList.toggle('on');
      if (wallEl) wallEl.classList.toggle('manager', on);
      if (on) {
        var key = String(window.prompt('输入管理员密码（与管理后台 ADMIN_KEY / 限流解锁 MS_ADMIN_KEY 一致；都没设时默认 rcj9527）。\n批量管理留言建议用 /admin 后台「留言墙」标签页，更顺手。') || '').trim();
        if (!key) { manage.classList.remove('on'); if (wallEl) wallEl.classList.remove('manager'); return; }
        window.__wallAdminKey = key;
      } else {
        window.__wallAdminKey = null;
      }
    });

    document.addEventListener('click', function (e) {
      var del = e.target.closest && e.target.closest('.wall-del');
      if (del && wallEl && wallEl.classList.contains('manager')) {
        var id = del.getAttribute('data-id');
        if (!window.__wallAdminKey) { window.alert('请先点「🗑 管理」并输入口令（或去 /admin 后台「留言墙」标签页批量管理）'); return; }
        if (window.confirm('确定删除这条留言？')) {
          deleteWall(id, window.__wallAdminKey).then(function (ok) {
            if (ok) loadWall(); else window.alert('删除失败，口令可能不对');
          });
        }
      }
    });

    loadWall();
    setInterval(loadWall, 30000); // 每 30s 拉新
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
