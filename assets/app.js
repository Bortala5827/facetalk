// FaceTalk v2 前端：双向互选流程
(function () {
  'use strict';
  var me = null;
  var dissolveTimer = null; // 首页：对方退出后房间倒计时自动关闭
  var roomDissolveToasted = false; // 首页：对方退出提示 toast 只弹一次

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
    var admin = sessionStorage.getItem('ft_admin') || '';
    var url = new URL(path, location.origin);
    if (method === 'GET') { url.searchParams.set('me', me); if (admin) url.searchParams.set('admin', admin); }
    var opt = { method: method, headers: {} };
    if (body) {
      var b = Object.assign({ me: me }, body);
      if (admin) b.adminKey = admin;
      opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(b);
    }
    var res = await fetch(url, opt);
    var d = {}; try { d = await res.json(); } catch (e) {}
    // 频率上限：若未输入过管理员密码，弹框输入后重试（便于作者自测）
    var rateErr = res.status === 429 && (d.error === 'rate_limited' || d.error === 'too_many_applies' || d.error === 'too_many_intents' || d.error === 'too_many_msgs');
    if (rateErr) {
      if (!admin) {
        var k = prompt('已达频率上限（防刷保护）。如要继续测试，请输入管理员密码：');
        if (k) { sessionStorage.setItem('ft_admin', k.trim()); return api(method, path, body); }
      } else {
        sessionStorage.removeItem('ft_admin'); // 密码错误，清除以便下次重新输入
      }
    }
    if (res.status === 503 && d.error === 'DB_NOT_BOUND') toast('后端存储正在初始化：请在 Cloudflare 绑定 D1 数据库（变量名 DB）', true);
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
      // 乐观插入「我发布的需求」，立即可见、避免重复提交（稍后 loadMine 用服务端数据校准）
      renderMineOptimistic({ id: r.data.id, role: body.role, city: body.city, mode: body.mode, note: body.note });
      loadBrowse(); loadInbox(); loadMine();
    } else {
      toast('发布失败：' + (r.data.error || r.status), true);
    }
  });

  // 浏览
  async function loadBrowse() {
    var r = await api('GET', '/api/intents');
    // 在线发需求人数（浅色 pill）
    if (r.status === 200 && typeof r.data.online === 'number') {
      var oc = $('online-count');
      if (oc) { oc.hidden = false; oc.innerHTML = '🌐 当前在线发需求 <b>' + r.data.online + '</b> 人'; }
    }
    var box = $('browse-list'); var empty = $('browse-empty'); box.innerHTML = '';
    if (r.status === 200 && r.data.list && r.data.list.length) {
      empty.hidden = true;
      var ownHint = $('browse-empty-own'); if (ownHint) ownHint.hidden = true;
      r.data.list.forEach(function (it) {
        var div = document.createElement('div'); div.className = 'li';
        var actionsHtml = it.isOwn
          ? '<button class="btn-mini no" data-del-own="' + esc(it.id) + '">删除</button>'
          : '<button class="btn-mini" data-apply="' + esc(it.id) + '">申请组队</button>';
        div.innerHTML = '<div class="li-main"><span class="tag tag-role">' + esc(it.role) + '</span>' +
          (it.city ? ' <span class="tag tag-city">' + esc(it.city) + '</span>' : '') +
          ' <span class="mode">' + modeLabel(it.mode) + '</span>' +
          (it.isOwn ? ' <span class="mode" style="background:#fff3cd;color:#856404">我的</span>' : '') +
          '</div>' +
          (it.note ? '<p class="li-note">' + esc(it.note) + '</p>' : '') +
          '<div class="li-foot"><span class="rep">⭐ ' + (it.rep != null ? it.rep : '50') + '</span>' +
          actionsHtml + '</div>';
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
      box.querySelectorAll('[data-del-own]').forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!confirm('确定删除这条意图？')) return;
          var id = b.getAttribute('data-del-own');
          var rr = await api('DELETE', '/api/intents?id=' + encodeURIComponent(id));
          if (rr.status === 200 && rr.data.ok) { toast('已删除'); loadBrowse(); }
          else toast('删除失败：' + (rr.data.error || rr.status), true);
        });
      });
    } else if (r.status === 200) {
      empty.hidden = false; empty.textContent = '还没有人发布意图，去发一个？';
      if (r.data.hasOwn) {
        var ownHint = $('browse-empty-own');
        if (ownHint) ownHint.hidden = false;
      }
    } else {
      empty.hidden = false; empty.textContent = '加载失败，点刷新重试';
    }
  }

  // 收到申请
  async function loadInbox() {
    var r = await api('GET', '/api/apply?box=in');
    var box = $('inbox-list'); var empty = $('inbox-empty'); box.innerHTML = '';
    if (r.status === 200 && r.data.list && r.data.list.length) {
      empty.hidden = true;
      // 找出已被「选定为 a_accepted」的意图；其下其它 pending 申请灰化（避免重复确认撞车、误点拒绝）
      var locked = {};
      r.data.list.forEach(function (a) { if (a.status === 'a_accepted' && a.intentId) locked[a.intentId] = true; });
      r.data.list.forEach(function (a) {
        var div = document.createElement('div'); div.className = 'li';
        // 双向互选：每个状态对应不同的下一步
        var decideHtml = '';
        if (a.status === 'pending') {
          if (locked[a.intentId]) {
            decideHtml = '<span class="muted">⏳ 你已选其他搭子，等待确认</span>';
          } else {
            decideHtml = '<button class="btn-mini ok" data-acc="' + esc(a.appId) + '">同意</button>' +
                         '<button class="btn-mini no" data-rej="' + esc(a.appId) + '">拒绝</button>';
          }
        } else if (a.status === 'a_accepted') {
          // A 已点头，等 B 也同意；A 可以撤回反悔
          decideHtml = '<span class="muted">⏳ 等他也同意</span>' +
                       '<button class="btn-mini grey" data-cancel-acc="' + esc(a.appId) + '">撤回</button>';
        } else if (a.status === 'both_accepted' || a.status === 'accepted') {
          // 'accepted' 为旧版状态（老代码「单方匹配」遗留），当作已配对展示
          decideHtml = '<span class="ok-mark">🤝 已配对</span> <button class="btn-mini" data-enter-room>进入房间</button>';
        } else {
          decideHtml = '<span class="muted">' + (a.status === 'rejected' ? '已拒绝' : '已撤回') + '</span>';
        }
        div.innerHTML = '<div class="li-main"><span class="tag">' + esc(a.role) + '</span>' +
          (a.city ? ' <span class="muted">' + esc(a.city) + '</span>' : '') +
          ' <span class="mode">' + modeLabel(a.mode) + '</span> <span class="rep">⭐' + (a.rep != null ? a.rep : '50') + '</span></div>' +
          (a.note ? '<p class="li-note">' + esc(a.note) + '</p>' : '') +
          '<div class="li-foot">' + decideHtml + '</div>';
        box.appendChild(div);
      });
      box.querySelectorAll('[data-acc]').forEach(function (b) {
        b.addEventListener('click', function () { decide(b.getAttribute('data-acc'), 'accept'); });
      });
      box.querySelectorAll('[data-rej]').forEach(function (b) {
        b.addEventListener('click', function () { decide(b.getAttribute('data-rej'), 'reject'); });
      });
      box.querySelectorAll('[data-cancel-acc]').forEach(function (b) {
        b.addEventListener('click', function () { decide(b.getAttribute('data-cancel-acc'), 'cancel-accept'); });
      });
      box.querySelectorAll('[data-enter-room]').forEach(function (b) {
        b.addEventListener('click', enterRoom);
      });
    } else if (r.status === 200) {
      empty.hidden = false; empty.textContent = '暂无人申请你，发布意图后等搭子来。';
    } else {
      empty.hidden = false; empty.textContent = '加载失败，点刷新重试';
    }
  }

  async function decide(appId, decision) {
    var r = await api('POST', '/api/pair', { action: 'decide', appId: appId, decision: decision });
    if (r.status === 200 && r.data.ok) {
      var msg;
      if (decision === 'accept') msg = '已同意，等对方也点头 ⏳';
      else if (decision === 'cancel-accept') msg = '已撤回';
      else msg = '已拒绝';
      toast(msg);
      loadInbox(); loadOut(); checkPair();
    } else toast('操作失败：' + (r.data.error || r.status), true);
  }

  // 发出申请
  async function loadOut() {
    var r = await api('GET', '/api/apply?box=out');
    var box = $('out-list'); var empty = $('out-empty'); box.innerHTML = '';
    if (r.status === 200 && r.data.list && r.data.list.length) {
      empty.hidden = true;
      r.data.list.forEach(function (o) {
        var s = '';
        var actions = '';
        if (o.status === 'pending') {
          s = '⏳ 待对方同意';
          actions = '<button class="btn-mini grey" data-cancel-app="' + esc(o.appId) + '">撤回</button>';
        } else if (o.status === 'a_accepted') {
          // B 看到 A 已点头的关键节点：B 现在点头 → 配对
          s = '✅ 对方已同意你！';
          actions = '<button class="btn-mini ok" data-bacc="' + esc(o.appId) + '">我也同意</button>' +
                    '<button class="btn-mini grey" data-cancel-app="' + esc(o.appId) + '">撤回</button>';
        } else if (o.status === 'both_accepted' || o.status === 'accepted') {
          s = '🤝 已互选成功';
          actions = '<button class="btn-mini" data-enter-room>进入房间</button>';
        } else if (o.status === 'rejected') {
          s = '已被拒绝';
        } else if (o.status === 'cancelled') {
          s = '已撤回';
        } else {
          s = o.status;
        }
        var div = document.createElement('div'); div.className = 'li';
        div.innerHTML = '<div class="li-main"><span class="muted">申请 ' + esc(o.intentId) + '</span></div>' +
          '<div class="li-foot"><span class="' + (o.status === 'both_accepted' ? 'ok-mark' : 'muted') + '">' + s + '</span> ' + actions + '</div>';
        box.appendChild(div);
      });
      box.querySelectorAll('[data-bacc]').forEach(function (b) {
        b.addEventListener('click', function () { bAccept(b.getAttribute('data-bacc')); });
      });
      box.querySelectorAll('[data-cancel-app]').forEach(function (b) {
        b.addEventListener('click', function () { cancelApply(b.getAttribute('data-cancel-app')); });
      });
      box.querySelectorAll('[data-enter-room]').forEach(function (b) {
        b.addEventListener('click', enterRoom);
      });
    } else if (r.status === 200) {
      empty.hidden = false; empty.textContent = '还没申请过别人。';
    } else {
      empty.hidden = false; empty.textContent = '加载失败，点刷新重试';
    }
  }

  async function bAccept(appId) {
    var r = await api('POST', '/api/pair', { action: 'b-accept', appId: appId });
    if (r.status === 200 && r.data.ok) {
      toast('已互选，进入房间 🤝');
      loadInbox(); loadOut(); checkPair();
    } else toast('同意失败：' + (r.data.error || r.status), true);
  }

  // 我发布的需求：发布后立即可见，避免重复提交；含申请人数与「等待搭子申请」状态
  async function loadMine() {
    var r = await api('GET', '/api/intents?box=mine');
    var box = $('mine-list'), empty = $('mine-empty');
    if (r.status === 200 && r.data.list && r.data.list.length) {
      empty.hidden = true; box.innerHTML = '';
      r.data.list.forEach(function (it) {
        var div = document.createElement('div'); div.className = 'li mine-intent';
        var n = it.applicants || 0;
        div.innerHTML = '<div class="li-main"><span class="tag tag-role">' + esc(it.role) + '</span>' +
          (it.city ? ' <span class="tag tag-city">' + esc(it.city) + '</span>' : '') +
          ' <span class="mode">' + modeLabel(it.mode) + '</span></div>' +
          (it.note ? '<p class="li-note">' + esc(it.note) + '</p>' : '') +
          '<div class="li-foot"><span class="muted">⏳ 等待搭子申请 · 已有 <b>' + n + '</b> 人申请</span>' +
          '<button class="btn-mini grey" data-cancel-intent="' + esc(it.id) + '">撤回</button></div>';
        box.appendChild(div);
      });
      box.querySelectorAll('[data-cancel-intent]').forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!confirm('撤回这条意图？撤回后搭子将看不到你。')) return;
          var rr = await api('DELETE', '/api/intents?id=' + encodeURIComponent(b.getAttribute('data-cancel-intent')));
          if (rr.status === 200 && rr.data.ok) { toast('已撤回'); loadMine(); loadBrowse(); }
          else toast('撤回失败：' + (rr.data.error || rr.status), true);
        });
      });
    } else if (r.status === 200) {
      empty.hidden = false; box.innerHTML = '';
    }
  }
  function renderMineOptimistic(it) {
    var box = $('mine-list'), empty = $('mine-empty');
    if (empty) empty.hidden = true;
    if (box.querySelector('[data-id="' + CSS.escape(it.id) + '"]')) return; // 避免重复
    var div = document.createElement('div'); div.className = 'li mine-intent'; div.dataset.id = it.id;
    div.innerHTML = '<div class="li-main"><span class="tag tag-role">' + esc(it.role) + '</span>' +
      (it.city ? ' <span class="tag tag-city">' + esc(it.city) + '</span>' : '') +
      ' <span class="mode">' + modeLabel(it.mode) + '</span></div>' +
      (it.note ? '<p class="li-note">' + esc(it.note) + '</p>' : '') +
      '<div class="li-foot"><span class="muted">⏳ 发布成功，等待搭子申请…</span></div>';
    box.appendChild(div);
  }

  // 用真实 pairId 跳转（不依赖 appId → pair 的映射）
  async function enterRoom() {
    var r = await api('GET', '/api/pair');
    if (r.status === 200 && r.data.pair && r.data.pair.pairId) {
      location.href = '/pair.html?pair=' + encodeURIComponent(r.data.pair.pairId);
    } else {
      toast('当前房间不可用，请到主页底部查看', true);
    }
  }

  async function cancelApply(appId) {
    if (!confirm('撤回这条申请？撤回后对方将看不到你。')) return;
    var r = await api('DELETE', '/api/apply?appId=' + encodeURIComponent(appId));
    if (r.status === 200 && r.data.ok) {
      toast('已撤回');
      loadInbox(); loadOut();
    } else toast('撤回失败：' + (r.data.error || r.status), true);
  }

  // 配对状态
  async function checkPair() {
    var r = await api('GET', '/api/pair');
    var p = r.status === 200 ? r.data.pair : null;
    // 房间已被服务端结算关闭 / 我已退出 → 视为无活跃房间，隐藏卡片（避免把"自己退出"显示成"对方退出"）
    if (p && (p.status === 'closed' || p.left)) { roomDissolveToasted = false; p = null; }
    if (dissolveTimer) { clearInterval(dissolveTimer); dissolveTimer = null; }
    // 对方已退出 → 房间进入「自动关闭倒计时」，对方端 1 分钟后彻底销毁
    if (p && p.dissolving) {
      var card = $('room-card');
      card.hidden = false;
      var enter = $('room-enter'); if (enter) enter.style.display = 'none';
      $('rate-card').hidden = true;
      var tip = $('room-dissolve-tip');
      if (!tip) { tip = document.createElement('p'); tip.id = 'room-dissolve-tip'; tip.className = 'dissolve-tip'; card.appendChild(tip); }
      tip.hidden = false;
      var secs = p.dissolveIn || 0;
      function paint() { tip.textContent = '⚠️ 对方已退出组队，房间将在 ' + Math.max(0, secs) + 's 后自动关闭。'; }
      paint();
      if (!roomDissolveToasted) { roomDissolveToasted = true; toast('⚠️ 对方已退出组队，房间即将自动关闭'); }
      if (secs <= 0) {
        api('POST', '/api/pair', { action: 'close', pairId: p.pairId }).then(function () { toast('房间已关闭'); loadBrowse(); loadInbox(); loadOut(); loadMine(); checkPair(); });
      } else {
        dissolveTimer = setInterval(function () {
          secs--;
          paint();
          if (secs <= 0) {
            clearInterval(dissolveTimer); dissolveTimer = null;
            api('POST', '/api/pair', { action: 'close', pairId: p.pairId }).then(function () { toast('房间已关闭'); loadBrowse(); loadInbox(); loadOut(); loadMine(); checkPair(); });
          }
        }, 1000);
      }
      return;
    }
    roomDissolveToasted = false;
    var rated = p && p.rated;
    var left = p && p.left;
    if (p && !rated && !left) {
      $('room-card').hidden = false;
      $('room-enter').href = '/pair.html?pair=' + encodeURIComponent(p.pairId) + '&v=20260804';
      $('room-enter').style.display = '';
      var oldTip = $('room-dissolve-tip'); if (oldTip) oldTip.hidden = true;
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

  // ============ 管理员面板 ============
  // 注：开关逻辑已移到 index.html 内联 onclick（不依赖本脚本，避免 JS 报错时无法展开）
  var adminPanel = $('admin-panel');
  var adminKeyInput = $('admin-key');
  var adminList = $('admin-list');

  async function adminAction(action, extra) {
    var key = adminKeyInput.value.trim();
    if (!key) { toast('请先输入管理员密钥', true); return; }
    var body = Object.assign({ admin: key, action: action }, extra || {});
    var res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    var d = {}; try { d = await res.json(); } catch (e) {}
    if (res.status === 200 && d.ok) return d;
    toast('管理操作失败：' + (d.error || res.status), true);
    return null;
  }

  async function adminLoadIntents() {
    var d = await adminAction('list_intents');
    if (!d) return;
    adminList.innerHTML = '';
    if (!d.list || !d.list.length) {
      adminList.innerHTML = '<p class="list-empty">暂无意图</p>';
      return;
    }
    d.list.forEach(function (it) {
      var div = document.createElement('div'); div.className = 'li';
      var time = new Date(it.created * 1000).toLocaleString('zh-CN');
      div.innerHTML = '<div class="li-main">' +
        '<span class="tag tag-role">' + esc(it.role) + '</span>' +
        (it.city ? ' <span class="tag tag-city">' + esc(it.city) + '</span>' : '') +
        ' <span class="muted" style="font-size:12px">' + esc(it.id) + '</span>' +
        '</div>' +
        (it.note ? '<p class="li-note">' + esc(it.note) + '</p>' : '') +
        '<div class="li-foot">' +
        '<span class="muted" style="font-size:12px">' + esc(it.owner) + ' · ' + time + '</span>' +
        '<span class="muted" style="font-size:12px">' + esc(it.status) + '</span>' +
        '<button class="btn-mini no" data-admin-del="' + esc(it.id) + '">删除</button>' +
        '</div>';
      adminList.appendChild(div);
    });
    adminList.querySelectorAll('[data-admin-del]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm('确定删除意图 ' + b.getAttribute('data-admin-del') + '？')) return;
        var r = await adminAction('delete_intent', { intentId: b.getAttribute('data-admin-del') });
        if (r) { toast('已删除'); adminLoadIntents(); loadBrowse(); }
      });
    });
  }

  var adminLoadBtn = $('admin-load');
  if (adminLoadBtn) adminLoadBtn.addEventListener('click', adminLoadIntents);

  var adminClearBtn = $('admin-clear');
  if (adminClearBtn) adminClearBtn.addEventListener('click', async function () {
    if (!confirm('⚠️ 将清空全部数据（意图 / 申请 / 搭子房 / 留言 / 举报 / 用户等），且不可恢复！\n确定继续？')) return;
    if (!confirm('再次确认：真的要一键清空全部数据吗？')) return;
    var r = await adminAction('clear_all');
    if (r) {
      toast('已清空全部数据');
      adminList.innerHTML = '<p class="list-empty">已清空</p>';
      loadBrowse(); loadInbox(); loadOut(); checkPair();
    }
  });

  async function boot() {
    try { await ensureToken(); } catch (e) { toast('无法获取身份，请稍后重试', true); }
    renderRep();
    loadBrowse(); loadInbox(); loadOut(); loadMine(); checkPair();
    // 重负载（看板/收件箱）仍 15s 刷新，避免滚动跳动；配对状态单独 5s 快轮询，对方退出即时响应
    setInterval(function () { loadBrowse(); loadInbox(); loadOut(); loadMine(); renderRep(); }, 15000);
    setInterval(checkPair, 5000);
  }
  boot();
})();
