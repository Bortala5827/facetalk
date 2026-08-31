// FaceTalk v2.1 前端：找搭子大厅 + 在线心跳 + 房间试音互评
(function () {
  'use strict';
  var me = null;
  var dissolveTimer = null;
  var roomDissolveToasted = false;
  var heartbeatTimer = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  }); }
  function modeLabel(m) { return m === 'video' ? t('modeVideoShort') : t('modeVoiceShort'); }
  function t(key, args) { return window.FTI18N ? FTI18N.t(key, args) : key; }
  function localeOf() {
    var L = window.FTI18N ? FTI18N.getLang() : 'zh';
    return L === 'ja' ? 'ja-JP' : L === 'en' ? 'en-US' : 'zh-CN';
  }
  // 岗位值以中文存库（跨语言保持一致、便于匹配），展示时按语言本地化
  function roleLabel(r) {
    var map = {
      '公务员 / 事业编': 'pubRoleGwy',
      '辅警 / 警务辅助': 'pubRoleFujing',
      '消防 / 政府专职消防员': 'pubRoleXiaofang',
      '书记员 / 公检法聘用人员': 'pubRoleShuji',
      '社区工作者 / 网格员': 'pubRoleShequ',
      '三支一扶 / 西部计划': 'pubRoleSanzhi',
      '其他': 'pubRoleOther'
    };
    return map[r] ? t(map[r]) : r;
  }
  // 申请的「失效」终态：用户不需要再做任何操作——变灰，淡化视觉权重
  // dissolved（房间已解散）已是失效；已配对（matched）/已拒/已撤也都是失效
  // pending / a_accepted（待我自己点头/撤回）不算失效
  function isInactive(a) {
    if (!a) return false;
    if (a.roomStatus === 'closed' || a.roomStatus === 'dissolving') return true;
    var s = a.status;
    return s === 'both_accepted' || s === 'accepted' || s === 'rejected' || s === 'cancelled';
  }

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

  async function api(method, path, body) {
    var admin = sessionStorage.getItem('ft_admin') || '';
    var url = new URL(path, location.origin);
    // GET 与 DELETE 都带 me（DELETE 无 body，身份必须放 URL；否则后端 requireToken 拿不到 token 直接 401）
    if (method === 'GET' || method === 'DELETE') { url.searchParams.set('me', me); if (admin) url.searchParams.set('admin', admin); }
    var opt = { method: method, headers: {} };
    if (body) {
      var b = Object.assign({ me: me }, body);
      if (admin) b.adminKey = admin;
      opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(b);
    }
    var res = await fetch(url, opt);
    var d = {}; try { d = await res.json(); } catch (e) {}
    var rateErr = res.status === 429 && (d.error === 'rate_limited' || d.error === 'too_many_applies' || d.error === 'too_many_intents' || d.error === 'too_many_msgs');
    if (rateErr) {
      if (!admin) {
        var k = prompt(t('ratePrompt'));
        if (k) { sessionStorage.setItem('ft_admin', k.trim()); return api(method, path, body); }
      } else {
        sessionStorage.removeItem('ft_admin');
      }
    }
    if (res.status === 503 && d.error === 'DB_NOT_BOUND') toast(t('dbNotBound'), true);
    else if (res.status === 403 && d.error === 'BANNED') toast(t('bannedToast'), true);
    else if (res.status === 401 && d.error === 'BAD_TOKEN') { if (window.FTMe) window.FTMe.del(); else localStorage.removeItem('ft_me'); location.reload(); }
    return { status: res.status, data: d };
  }

  async function ensureToken() {
    // v2.3 无痕/隐私模式兜底：URL ?me= → localStorage → Cookie（FTMe 双写）
    var urlMe = null;
    try { urlMe = new URL(location.href).searchParams.get('me'); } catch (e) {}
    me = urlMe || (window.FTMe ? window.FTMe.get() : localStorage.getItem('ft_me'));
    if (me) {
      var r = await rawGet('/api/identity?id=' + encodeURIComponent(me));
      if (r.status === 200 && !r.data.banned) { if (window.FTMe) window.FTMe.set(me); return; }
    }
    var res = await fetch('/api/identity', { method: 'POST' });
    var d = {}; try { d = await res.json(); } catch (e) {}
    me = d.id;
    if (window.FTMe) window.FTMe.set(me); else localStorage.setItem('ft_me', me);
  }

  function renderRep() {
    if (!me) return;
    rawGet('/api/identity?id=' + encodeURIComponent(me)).then(function (r) {
      if (r.status === 200) $('my-rep').textContent = r.data.rep;
    });
  }

  // ======================== 2.1 心跳保活 ========================
  function sendHeartbeat() {
    if (!me) return;
    fetch('/api/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ me: me })
    }).catch(function () {});
  }

  function startHeartbeat() {
    sendHeartbeat(); // 进页面立刻发一次
    heartbeatTimer = setInterval(sendHeartbeat, 180000); // 每 3 分钟
  }

  // 批量查询在线状态
  async function batchOnlineStatus(userIds) {
    if (!userIds || !userIds.length) return {};
    try {
      var r = await rawGet('/api/heartbeat?users=' + encodeURIComponent(userIds.join(',')));
      return (r.status === 200 && r.data.online) ? r.data.online : {};
    } catch (e) { return {}; }
  }

  // ======================== 2.1 URL 参数自动填充 ========================
  function applyRoleFromUrl() {
    try {
      var params = new URL(location.href).searchParams;
      var role = params.get('role');
      if (!role) return;
      var map = {
        'gongkao': '公务员 / 事业编',
        'fujing': '辅警 / 警务辅助',
        'xiaofang': '消防 / 政府专职消防员',
        'shujiyuan': '书记员 / 公检法聘用人员',
        'shequ': '社区工作者 / 网格员',
        'sanzhiyifu': '三支一扶 / 西部计划',
        'other': '其他'
      };
      var label = map[role] || role;
      var sel = $('i-role');
      for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === label || sel.options[i].text === label) {
          sel.selectedIndex = i;
          toast(t('roleAuto') + roleLabel(label));
          // 滚动到表单
          sel.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
      }
    } catch (e) {}
  }

  // ======================== 发布意图 ========================
  $('intent-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var body = {
      role: $('i-role').value, city: $('i-city').value.trim(),
      mode: $('i-mode').value, note: $('i-note').value.trim(),
    };
    var r = await api('POST', '/api/intents', body);
    if (r.status === 200 && r.data.ok) {
      toast(t('pubOk'));
      $('i-city').value = ''; $('i-note').value = '';
      renderMineOptimistic({ id: r.data.id, role: body.role, city: body.city, mode: body.mode, note: body.note });
      loadBrowse(); loadInbox(); loadMine();
      // 发布成功后自动折叠表单区，让首屏聚焦「找人筛选」
      var pd = document.getElementById('pair-details');
      if (pd) pd.removeAttribute('open');
    } else {
      toast(t('pubFail') + (r.data.error || r.status), true);
    }
  });

  // ======================== 浏览大厅（在线状态 + 排序）========================
  async function loadBrowse() {
    var r = await api('GET', '/api/intents');
    if (r.status === 200 && typeof r.data.online === 'number') {
      var oc = $('online-count');
      if (oc) { oc.hidden = false; oc.innerHTML = t('onlineCount', [r.data.online]); }
    }
    var box = $('browse-list'); var empty = $('browse-empty'); box.innerHTML = '';
    if (r.status !== 200 || !r.data.list || !r.data.list.length) {
      empty.hidden = false; empty.textContent = r.status === 200 ? t('browseEmpty') : t('loadFail');
      return;
    }
    empty.hidden = true;
    var ownHint = $('browse-empty-own'); if (ownHint) ownHint.hidden = true;

    // 收集所有非自己的意图 owner，批量查在线状态
    var owners = [];
    r.data.list.forEach(function (it) {
      if (!it.isOwn && it.owner) owners.push(it.owner);
    });
    var onlineMap = await batchOnlineStatus(owners);

    // 2.1 排序：在线 > 活跃 > 历史；同类内按发布时间倒序
    function statusWeight(it) {
      if (it.isOwn) return -1; // 自己的排最前
      var s = onlineMap[it.owner];
      if (s === 'online') return 0;
      if (s === 'active') return 1;
      return 2;
    }
    r.data.list.sort(function (a, b) {
      var wa = statusWeight(a), wb = statusWeight(b);
      if (wa !== wb) return wa - wb;
      return (b.created || 0) - (a.created || 0);
    });

    r.data.list.forEach(function (it) {
      var div = document.createElement('div'); div.className = 'li';
      var s = onlineMap[it.owner];

      // 在线状态灯
      var statusDot = '', statusText = '';
      if (!it.isOwn && s === 'online') {
        statusDot = '<span class="online-dot green"></span>';
        statusText = '<span class="online-label green">' + t('onlineNow') + '</span>';
      } else if (!it.isOwn && s === 'active') {
        statusDot = '<span class="online-dot orange"></span>';
        statusText = '<span class="online-label orange">' + t('activeNow') + '</span>';
      } else if (!it.isOwn) {
        // 历史：显示发布时间
        var delta = Math.floor((Date.now()/1000 - (it.created || 0)) / 60);
        statusText = delta < 60 ? '<span class="online-label muted">' + t('minsAgo', [delta]) + '</span>' :
                     delta < 1440 ? '<span class="online-label muted">' + t('hoursAgo', [Math.floor(delta/60)]) + '</span>' :
                     '<span class="online-label muted">' + t('daysAgo', [Math.floor(delta/1440)]) + '</span>';
      }

      // 动作按钮：自己的 → 删除；别人的 → 申请组队
      // 试音/录音只在「进房间后」才能发起，大厅里只做组队（避免绕过互选导致混乱）
      var actionsHtml;
      if (it.isOwn) {
        actionsHtml = '<button class="btn-mini no" data-del-own="' + esc(it.id) + '">' + t('delete') + '</button>';
      } else {
        actionsHtml = '<button class="btn-mini" data-apply="' + esc(it.id) + '">' + t('applyTeam') + '</button>';
      }

      div.innerHTML = '<div class="li-main">' + statusDot +
        '<span class="tag tag-role">' + esc(roleLabel(it.role)) + '</span>' +
        (it.city ? ' <span class="tag tag-city">' + esc(it.city) + '</span>' : '') +
        ' <span class="mode">' + modeLabel(it.mode) + '</span>' +
        statusText +
        (it.isOwn ? ' <span class="mode" style="background:#fff3cd;color:#856404">' + t('mineTag') + '</span>' : '') +
        '</div>' +
        (it.note ? '<p class="li-note">' + esc(it.note) + '</p>' : '') +
        '<div class="li-foot"><span class="rep">⭐ ' + (it.rep != null ? it.rep : '50') + '</span>' +
        actionsHtml + '</div>';
      box.appendChild(div);
    });

    // 申请组队
    box.querySelectorAll('[data-apply]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var rr = await api('POST', '/api/apply', { intentId: b.getAttribute('data-apply') });
        if (rr.status === 200 && rr.data.ok) toast(t('applied'));
        else toast(t('applyFail') + (rr.data.error || rr.status), true);
        loadOut();
      });
    });

    // 删除自己的意图
    box.querySelectorAll('[data-del-own]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm(t('delIntentConfirm'))) return;
        var id = b.getAttribute('data-del-own');
        var rr = await api('DELETE', '/api/intents?id=' + encodeURIComponent(id));
        if (rr.status === 200 && rr.data.ok) { toast(t('delDone')); loadBrowse(); }
        else toast(t('delFail') + (rr.data.error || rr.status), true);
      });
    });
  }

  // ======================== 收到申请 ========================
  async function loadInbox() {
    var r = await api('GET', '/api/apply?box=in');
    var box = $('inbox-list'); var empty = $('inbox-empty'); box.innerHTML = '';
    if (r.status === 200 && r.data.list && r.data.list.length) {
      empty.hidden = true;
      // 兜底去重：后端已按 (intent_id, applicant) 合并，但若返回里仍有重复，
      // 防御性按 (intentId, applicant) 再 dedupe 一次，保留 created 最大的
      var seen = {};
      r.data.list.forEach(function (a) {
        var k = (a.intentId || '') + '|' + (a.applicant || a.appId);
        if (!seen[k] || (a.created || 0) > (seen[k].created || 0)) seen[k] = a;
      });
      var list = Object.values(seen);

      var locked = {};
      list.forEach(function (a) { if (a.status === 'a_accepted' && a.intentId && !a.roomStatus) locked[a.intentId] = true; });
      list.forEach(function (a) {
        var div = document.createElement('div'); div.className = 'li';
        var dissolved = (a.roomStatus === 'closed' || a.roomStatus === 'dissolving');
        var inactive = isInactive(a);
        var decideHtml = '';
        if (a.status === 'pending') {
          if (locked[a.intentId]) {
            decideHtml = '<span class="muted" title="' + t('pendingOtherLockTitle') + '">' + t('pendingOtherLock') + '</span>';
          } else if (dissolved) {
            decideHtml = '<span class="muted">' + t('roomDissolvedRematch') + '</span> ' +
                         '<button class="btn-mini ok" data-acc="' + esc(a.appId) + '">' + t('rematch') + '</button>' +
                         '<button class="btn-mini no" data-rej="' + esc(a.appId) + '">' + t('reject') + '</button>';
          } else {
            decideHtml = '<button class="btn-mini ok" data-acc="' + esc(a.appId) + '">' + t('agree') + '</button>' +
                         '<button class="btn-mini no" data-rej="' + esc(a.appId) + '">' + t('reject') + '</button>';
          }
        } else if (a.status === 'a_accepted') {
          decideHtml = dissolved
            ? '<span class="muted">' + t('roomDissolved') + '</span>'
            : '<span class="muted">' + t('waitThem') + '</span><button class="btn-mini grey" data-cancel-acc="' + esc(a.appId) + '">' + t('withdraw') + '</button>';
        } else if (a.status === 'both_accepted' || a.status === 'accepted') {
          decideHtml = dissolved
            ? '<span class="muted">' + t('roomDissolved') + '</span>'
            : '<span class="ok-mark">' + t('paired') + '</span> <button class="btn-mini" data-enter-room>' + t('enterRoom') + '</button>';
        } else {
          decideHtml = '<span class="muted">' + (a.status === 'rejected' ? t('rejectedTag') : t('withdrawnTag')) + '</span>';
        }
        if (dissolved && a.status !== 'pending') div.className = 'li dissolved';
        if (inactive && !div.classList.contains('dissolved')) div.className = 'li inactive';
        else if (inactive && div.classList.contains('dissolved')) div.className = 'li dissolved inactive';
        div.innerHTML = '<div class="li-main"><span class="tag">' + esc(roleLabel(a.role)) + '</span>' +
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
      empty.hidden = false; empty.textContent = t('inboxEmpty');
    } else {
      empty.hidden = false; empty.textContent = t('loadFail');
    }
    // 待你同意的收到申请：点亮「我的搭子状态」折叠标题红点，防止漏同意（双向匹配关键）
    var pendingIn = (typeof list !== 'undefined' && list) ? list.filter(function (a) { return a.status === 'pending'; }).length : 0;
    var dot = $('statusDot'); var det = $('my-status');
    if (dot) {
      dot.hidden = pendingIn === 0;
      dot.setAttribute('title', pendingIn > 0 ? t('hasPending', [pendingIn]) : '');
      det.classList.toggle('has-pending', pendingIn > 0);
    }
  }

  async function decide(appId, decision) {
    var r = await api('POST', '/api/pair', { action: 'decide', appId: appId, decision: decision });
    if (r.status === 200 && r.data.ok) {
      var msg;
      if (decision === 'accept') msg = t('decideAccept');
      else if (decision === 'cancel-accept') msg = t('withdrawDone');
      else msg = t('rejectedTag');
      toast(msg);
      loadInbox(); loadOut(); checkPair();
    } else toast(t('opFailColon') + (r.data.error || r.status), true);
  }

  // ======================== 发出申请 ========================
  async function loadOut() {
    var r = await api('GET', '/api/apply?box=out');
    var box = $('out-list'); var empty = $('out-empty'); box.innerHTML = '';
    if (r.status === 200 && r.data.list && r.data.list.length) {
      empty.hidden = true;
      r.data.list.forEach(function (o) {
        var s = '';
        var actions = '';
        var dissolved = (o.roomStatus === 'closed' || o.roomStatus === 'dissolving');
        if (o.status === 'pending') {
          s = t('waitingThem');
          actions = '<button class="btn-mini grey" data-cancel-app="' + esc(o.appId) + '">' + t('withdraw') + '</button>';
        } else if (o.status === 'a_accepted') {
          s = dissolved ? t('roomDissolved') : t('peerApproved');
          actions = dissolved ? '' : '<button class="btn-mini ok" data-bacc="' + esc(o.appId) + '">' + t('iAgreeToo') + '</button>' +
                    '<button class="btn-mini grey" data-cancel-app="' + esc(o.appId) + '">' + t('withdraw') + '</button>';
        } else if (o.status === 'both_accepted' || o.status === 'accepted') {
          s = dissolved ? t('roomDissolved') : t('matchedDone');
          actions = dissolved ? '' : '<button class="btn-mini" data-enter-room>' + t('enterRoom') + '</button>';
        } else if (o.status === 'rejected') {
          s = t('beenRejected');
        } else if (o.status === 'cancelled') {
          s = t('withdrawnSelf');
        } else {
          s = o.status;
        }
        var div = document.createElement('div');
        var cls = ['li'];
        if (dissolved && o.status !== 'pending') cls.push('dissolved');
        if (isInactive(o) && o.status !== 'pending') cls.push('inactive');
        div.className = cls.join(' ');
        div.innerHTML = '<div class="li-main"><span class="muted">' + t('applyPrefix') + ' ' + esc(o.intentId) + '</span></div>' +
          '<div class="li-foot"><span class="' + (o.status === 'both_accepted' && !dissolved ? 'ok-mark' : 'muted') + '">' + s + '</span> ' + actions + '</div>';
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
      empty.hidden = false; empty.textContent = t('outEmpty');
    } else {
      empty.hidden = false; empty.textContent = t('loadFail');
    }
  }

  async function bAccept(appId) {
    var r = await api('POST', '/api/pair', { action: 'b-accept', appId: appId });
    if (r.status === 200 && r.data.ok) {
      toast(t('matchedEnter'));
      loadInbox(); loadOut(); checkPair();
    } else toast(t('agreeFail') + (r.data.error || r.status), true);
  }

  // ======================== 我发布的需求 ========================
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
          '<div class="li-foot"><span class="muted">' + t('mineWaiting', [n]) + '</span>' +
          '<button class="btn-mini grey" data-cancel-intent="' + esc(it.id) + '">' + t('withdraw') + '</button></div>';
        box.appendChild(div);
      });
      box.querySelectorAll('[data-cancel-intent]').forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!confirm(t('withdrawIntentConfirm'))) return;
          var rr = await api('DELETE', '/api/intents?id=' + encodeURIComponent(b.getAttribute('data-cancel-intent')));
          if (rr.status === 200 && rr.data.ok) { toast(t('withdrawDone')); loadMine(); loadBrowse(); }
          else toast(t('withdrawFail') + (rr.data.error || rr.status), true);
        });
      });
    } else if (r.status === 200) {
      empty.hidden = false; box.innerHTML = '';
    }
  }
  function renderMineOptimistic(it) {
    var box = $('mine-list'), empty = $('mine-empty');
    if (empty) empty.hidden = true;
    if (box.querySelector('[data-id="' + it.id + '"]')) return;
    var div = document.createElement('div'); div.className = 'li mine-intent'; div.dataset.id = it.id;
    div.innerHTML = '<div class="li-main"><span class="tag tag-role">' + esc(it.role) + '</span>' +
      (it.city ? ' <span class="tag tag-city">' + esc(it.city) + '</span>' : '') +
      ' <span class="mode">' + modeLabel(it.mode) + '</span></div>' +
      (it.note ? '<p class="li-note">' + esc(it.note) + '</p>' : '') +
      '<div class="li-foot"><span class="muted">' + t('minePosting') + '</span></div>';
    box.appendChild(div);
  }

  // v2.4：进入房间前实时校验状态，防止进入已解散/关闭/已退出的死房间
  async function enterRoom() {
    var r = await api('GET', '/api/pair');
    var p = r.status === 200 ? r.data.pair : null;
    if (!p || p.status === 'closed' || p.dissolving || p.left) {
      toast(p ? t('roomClosedNoEnter') : t('noRoomNow'), true);
      checkPair(); // 刷新卡片状态
      return;
    }
    location.href = '/pair.html?pair=' + encodeURIComponent(p.pairId) + '&me=' + encodeURIComponent(me);
  }

  async function cancelApply(appId) {
    if (!confirm(t('withdrawApplyConfirm'))) return;
    var r = await api('DELETE', '/api/apply?appId=' + encodeURIComponent(appId));
    if (r.status === 200 && r.data.ok) {
      toast(t('withdrawDone'));
      loadInbox(); loadOut();
    } else toast(t('withdrawFail') + (r.data.error || r.status), true);
  }

  // ======================== 配对状态 ========================
  async function checkPair() {
    var r = await api('GET', '/api/pair');
    var p = r.status === 200 ? r.data.pair : null;
    if (p && (p.status === 'closed' || p.left)) { roomDissolveToasted = false; p = null; }
    if (dissolveTimer) { clearInterval(dissolveTimer); dissolveTimer = null; }
    if (p && p.dissolving) {
      var card = $('room-card');
      card.hidden = false;
      var enter = $('room-enter'); if (enter) enter.style.display = 'none';
      $('rate-card').hidden = true;
      var tip = $('room-dissolve-tip');
      if (!tip) { tip = document.createElement('p'); tip.id = 'room-dissolve-tip'; tip.className = 'dissolve-tip'; card.appendChild(tip); }
      tip.hidden = false;
      var secs = p.dissolveIn || 0;
      function paint() { tip.textContent = t('peerLeftCountdown', [Math.max(0, secs)]); }
      paint();
      if (!roomDissolveToasted) { roomDissolveToasted = true; toast(t('peerLeftToast')); }
      if (secs <= 0) {
        api('POST', '/api/pair', { action: 'close', pairId: p.pairId }).then(function () { toast(t('roomClosed')); loadBrowse(); loadInbox(); loadOut(); loadMine(); checkPair(); });
      } else {
        dissolveTimer = setInterval(function () {
          secs--;
          paint();
          if (secs <= 0) {
            clearInterval(dissolveTimer); dissolveTimer = null;
            api('POST', '/api/pair', { action: 'close', pairId: p.pairId }).then(function () { toast(t('roomClosed')); loadBrowse(); loadInbox(); loadOut(); loadMine(); checkPair(); });
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
      $('room-enter').href = '/pair.html?pair=' + encodeURIComponent(p.pairId) + '&me=' + encodeURIComponent(me);
      $('room-enter').style.display = '';
      var oldTip = $('room-dissolve-tip'); if (oldTip) oldTip.hidden = true;
      if (p.status === 'done' && !rated) $('rate-card').hidden = false; else $('rate-card').hidden = true;
      // 2.1：显示我对对方的评价等待状态
      if (p.myRatingSubmitted && !p.rated) {
        $('rate-card').hidden = true;
        $('room-card').hidden = false;
        $('room-enter').textContent = t('ratingSubmittedWait');
        $('room-enter').href = '#';
        $('room-enter').style.display = '';
        $('room-enter').style.background = '#fff3cd';
      }
    } else {
      $('room-card').hidden = true; $('rate-card').hidden = true;
    }
  }

  // ======================== 互评 ========================
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
      if (r.data.waiting) {
        toast(t('ratingSubmittedWait'));
      } else {
        toast(t('ratingThanks'));
      }
      $('rate-card').hidden = true;
      renderRep();
    } else toast(t('ratingFail') + (r.data.error || r.status), true);
  });

  $('browse-refresh').addEventListener('click', loadBrowse);

  // ======================== 管理员面板（不变） ========================
  var adminPanel = $('admin-panel');
  var adminKeyInput = $('admin-key');
  var adminList = $('admin-list');

  async function adminAction(action, extra) {
    var key = adminKeyInput.value.trim();
    if (!key) { toast(t('adminNeedKey'), true); return; }
    var body = Object.assign({ admin: key, action: action }, extra || {});
    var res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    var d = {}; try { d = await res.json(); } catch (e) {}
    if (res.status === 200 && d.ok) return d;
    toast(t('adminOpFail') + (d.error || res.status), true);
    return null;
  }

  async function adminLoadIntents() {
    var d = await adminAction('list_intents');
    if (!d) return;
    adminList.innerHTML = '';
    if (!d.list || !d.list.length) {
      adminList.innerHTML = '<p class="list-empty">' + t('adminEmptyIntents') + '</p>';
      return;
    }
    d.list.forEach(function (it) {
      var div = document.createElement('div'); div.className = 'li';
      var time = new Date(it.created * 1000).toLocaleString(localeOf());
      div.innerHTML = '<div class="li-main">' +
        '<span class="tag tag-role">' + esc(roleLabel(it.role)) + '</span>' +
        (it.city ? ' <span class="tag tag-city">' + esc(it.city) + '</span>' : '') +
        ' <span class="muted" style="font-size:12px">' + esc(it.id) + '</span>' +
        '</div>' +
        (it.note ? '<p class="li-note">' + esc(it.note) + '</p>' : '') +
        '<div class="li-foot">' +
        '<span class="muted" style="font-size:12px">' + esc(it.owner) + ' · ' + time + '</span>' +
        '<span class="muted" style="font-size:12px">' + esc(it.status) + '</span>' +
        '<button class="btn-mini no" data-admin-del="' + esc(it.id) + '">' + t('adminDel') + '</button>' +
        '</div>';
      adminList.appendChild(div);
    });
    adminList.querySelectorAll('[data-admin-del]').forEach(function (b) {
      b.addEventListener('click', async function () {
        if (!confirm(t('adminDelIntentConfirm') + ' ' + b.getAttribute('data-admin-del') + '？')) return;
        var r = await adminAction('delete_intent', { intentId: b.getAttribute('data-admin-del') });
        if (r) { toast(t('delDone')); adminLoadIntents(); loadBrowse(); }
      });
    });
  }

  var adminLoadBtn = $('admin-load');
  if (adminLoadBtn) adminLoadBtn.addEventListener('click', adminLoadIntents);

  var adminClearBtn = $('admin-clear');
  if (adminClearBtn) adminClearBtn.addEventListener('click', async function () {
    if (!confirm(t('adminClearConfirm1'))) return;
    if (!confirm(t('adminClearConfirm2'))) return;
    var r = await adminAction('clear_all');
    if (r) {
      toast(t('adminClearedToast'));
      adminList.innerHTML = '<p class="list-empty">' + t('adminClearedEmpty') + '</p>';
      loadBrowse(); loadInbox(); loadOut(); checkPair();
    }
  });

  // ======================== 启动 ========================
  async function boot() {
    try { await ensureToken(); } catch (e) { toast(t('getIdentityFail'), true); }
    renderRep();
    applyRoleFromUrl(); // 2.1：URL 参数自动填充岗位
    startHeartbeat();  // 2.1：启动心跳保活
    loadBrowse(); loadInbox(); loadOut(); loadMine(); checkPair();
    setInterval(function () { loadBrowse(); loadInbox(); loadOut(); loadMine(); renderRep(); }, 15000);
    setInterval(checkPair, 5000);
    // 语言切换后重渲染动态区
    if (window.FTI18N) window.FTI18N.onChange(function () { loadBrowse(); loadInbox(); loadOut(); loadMine(); checkPair(); renderRep(); });
    // v2.4：拦截「进入搭子房间」按钮，点击时实时校验而非依赖轮询刷新的 href
    var re = $('room-enter');
    if (re) re.addEventListener('click', function (e) {
      e.preventDefault();
      enterRoom();
    });
  }
  boot();
})();
