// 面试搭子 · 面试匹配系统（前端）
// 纯静态 + Cloudflare Pages Functions(KV)。数据走 /api/*，不发任何第三方。
(function () {
  'use strict';

  const isWeChat = /micromessenger/i.test(navigator.userAgent);
  if (isWeChat) {
    const wt = document.getElementById('wx-tip');
    if (wt) wt.hidden = false;
  }

  // 读取 URL 查询参数（模块化调用：?role=辅警 / ?from=fj）
  function getParam(name) {
    const m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  // 上下文返回链接：让辅警 / 消防 / Hub 站调起后仍能一键回到来源
  const CTX = {
    hub: ['返回 RCJ Hub', 'https://955827.xyz'],
    fj: ['返回辅警站', 'https://fj.rcj9527.dpdns.org'],
    xf: ['返回消防站', 'https://xf.955827.xyz']
  };
  const ctxBack = document.getElementById('ctx-back');
  if (ctxBack) {
    const fromP = getParam('from');
    if (CTX[fromP]) {
      ctxBack.textContent = '← ' + CTX[fromP][0];
      ctxBack.href = CTX[fromP][1];
      ctxBack.hidden = false;
    }
  }

  // 岗位预选：来源站用 ?role= 直接调起对应岗位
  const roleParam = getParam('role');
  if (roleParam) {
    const norm = { '消防': '消防员', '消防员': '消防员', '警察': '辅警', '公安': '辅警', '辅警': '辅警' };
    const rv = norm[roleParam] || roleParam;
    ['m-role', 'msg-role'].forEach(function (id) {
      const sel = document.getElementById(id);
      if (!sel) return;
      const exists = Array.prototype.some.call(sel.options, function (o) { return o.value === rv; });
      if (exists) sel.value = rv;
    });
  }

  function esc(s) {
    return (s || '').replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function timeAgo(ts) {
    const d = Math.floor((Date.now() - (ts || 0)) / 1000);
    if (d < 60) return '刚刚';
    if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
    if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
    return Math.floor(d / 86400) + ' 天前';
  }
  function tag(text, cls) {
    return text ? '<span class="tag ' + cls + '">' + esc(text) + '</span>' : '';
  }
  function showMsg(el, text, ok) {
    el.textContent = text;
    el.className = 'form-msg ' + (ok ? 'ok' : 'err');
    el.hidden = false;
  }

  // ---------- 通用复制 ----------
  function copyText(text, btn) {
    const done = function () {
      const old = btn.textContent;
      btn.textContent = '已复制 ✓';
      setTimeout(function () { btn.textContent = old; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  }

  // ---------- 提交：发布腾讯会议室 ----------
  const meetForm = document.getElementById('meet-form');
  const meetMsg = document.getElementById('m-msg');
  if (meetForm) {
    const mInput = document.getElementById('m-meeting');
    const mHint = document.getElementById('m-meeting-hint');
    mInput.addEventListener('input', function () {
      const v = mInput.value.trim();
      if (/meeting\.tencent\.com/i.test(v)) { mHint.textContent = '已识别：腾讯会议'; mHint.className = 'field-hint ok'; }
      else if (/feishu|larksuite|zoom/i.test(v)) { mHint.textContent = '本版仅支持腾讯会议，飞书请在留言板说明'; mHint.className = 'field-hint warn'; }
      else if (v.replace(/[^0-9]/g, '').length >= 9) { mHint.textContent = '将作为腾讯会议号发布'; mHint.className = 'field-hint ok'; }
      else if (v) { mHint.textContent = '仅支持腾讯会议链接或 9–11 位会议号'; mHint.className = 'field-hint warn'; }
      else { mHint.textContent = '仅支持腾讯会议（飞书等请在下方留言板说明）'; mHint.className = 'field-hint'; }
    });

    meetForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const meeting = mInput.value.trim();
      if (!meeting) { showMsg(meetMsg, '请填写腾讯会议链接或会议号', false); return; }
      const payload = {
        meeting: meeting,
        role: document.getElementById('m-role').value,
        city: document.getElementById('m-city').value.trim(),
        note: document.getElementById('m-note').value.trim(),
        contactType: document.getElementById('m-contactType').value,
        contact: document.getElementById('m-contact').value.trim()
      };
      postJSON('/api/meetings', payload, meetMsg, meetForm);
    });
  }

  // ---------- 提交：留言板 ----------
  const msgForm = document.getElementById('msg-form');
  const msgMsg = document.getElementById('msg-msg');
  if (msgForm) {
    msgForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const text = document.getElementById('msg-text').value.trim();
      if (!text) { showMsg(msgMsg, '留言内容不能为空', false); return; }
      const payload = {
        text: text,
        role: document.getElementById('msg-role').value,
        city: document.getElementById('msg-city').value.trim(),
        contact: document.getElementById('msg-contact').value.trim()
      };
      postJSON('/api/messages', payload, msgMsg, msgForm);
    });
  }

  function postJSON(url, payload, msgEl, form) {
    showMsg(msgEl, '发布中…', true);
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d.ok) {
          showMsg(msgEl, '✅ 已发布，已显示在下方列表', true);
          form.reset();
          // 保留 ?role 预选
          if (roleParam) {
            const norm = { '消防': '消防员', '消防员': '消防员', '警察': '辅警', '公安': '辅警', '辅警': '辅警' };
            const rv = norm[roleParam] || roleParam;
            ['m-role', 'msg-role'].forEach(function (id) {
              const sel = document.getElementById(id);
              if (sel && Array.prototype.some.call(sel.options, function (o) { return o.value === rv; })) sel.value = rv;
            });
          }
          refresh();
        } else {
          showMsg(msgEl, '❌ ' + ((res.d && res.d.message) || '发布失败，请重试'), false);
        }
      })
      .catch(function () { showMsg(msgEl, '❌ 网络异常，请稍后重试', false); });
  }

  // ---------- 渲染列表 ----------
  function renderMeetings(items) {
    const list = document.getElementById('meet-list');
    const empty = document.getElementById('meet-empty');
    const count = document.getElementById('meet-count');
    count.textContent = items.length;
    if (!items.length) { list.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true;
    list.innerHTML = items.map(function (it) {
      const meta = tag(it.role, 'tag-role') + tag(it.city, 'tag-city');
      const note = it.note ? '<p class="li-note">' + esc(it.note) + '</p>' : '';
      const contact = it.contact ? '<span class="li-contact">' + esc(it.contactType || '联系') + '：' + esc(it.contact) + '</span>' : '';
      return '<div class="li">' +
        '<div class="li-main">' +
          '<div class="li-top">' + meta + '<span class="li-time">' + timeAgo(it.created) + '</span></div>' +
          note +
          '<div class="li-actions">' +
            '<a class="btn-join" href="' + esc(it.meeting) + '" target="_blank" rel="noopener">▶ 一键入会</a>' +
            '<button class="btn-mini" data-copy="' + esc(it.raw || it.meeting) + '">复制会议号</button>' +
            contact +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
    list.querySelectorAll('.btn-mini').forEach(function (b) {
      b.addEventListener('click', function () { copyText(b.getAttribute('data-copy'), b); });
    });
  }

  function renderMessages(items) {
    const list = document.getElementById('msg-list');
    const empty = document.getElementById('msg-empty');
    const count = document.getElementById('msg-count');
    count.textContent = items.length;
    if (!items.length) { list.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true;
    list.innerHTML = items.map(function (it) {
      const meta = tag(it.role, 'tag-role') + tag(it.city, 'tag-city');
      const contact = it.contact ? '<span class="li-contact">' + esc(it.contact) + '</span>' : '';
      return '<div class="li li-msg"><div class="li-main">' +
        '<div class="li-top">' + meta + '<span class="li-time">' + timeAgo(it.created) + '</span></div>' +
        '<p class="li-text">' + esc(it.text) + '</p>' +
        contact +
      '</div></div>';
    }).join('');
  }

  function refresh() {
    Promise.all([
      fetch('/api/meetings').then(function (r) { return r.json(); }),
      fetch('/api/messages').then(function (r) { return r.json(); })
    ]).then(function (res) {
      const m = (res[0] && res[0].items) || [];
      const s = (res[1] && res[1].items) || [];
      renderMeetings(m);
      renderMessages(s);
      if ((res[0] && res[0].error === 'KV_NOT_BOUND') || (res[1] && res[1].error === 'KV_NOT_BOUND')) {
        const em = document.getElementById('meet-empty');
        if (em) { em.textContent = '后端存储正在初始化，刷新稍候…'; em.hidden = false; }
        const sm = document.getElementById('msg-empty');
        if (sm) { sm.textContent = '后端存储正在初始化，刷新稍候…'; sm.hidden = false; }
      }
    }).catch(function () {});
  }

  refresh();
  setInterval(refresh, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
})();
