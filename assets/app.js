// 面试搭子 MVP —— 纯前端：数据编码进 URL hash，无后端
// 功能：生成匹配页 / 倒计时 / 加日历(.ics) / 互评反馈卡 / 录音口语分析
(function () {
  'use strict';

  var isWeChat = /micromessenger/i.test(navigator.userAgent);

  // 读取 URL 查询参数（模块化调用：?role=辅警 / ?from=fj）
  function getParam(name) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }

  // 上下文返回链接：让辅警 / 消防 / Hub 站调起后仍能一键回到来源
  var CTX = {
    hub: ['返回 RCJ Hub', 'https://955827.xyz'],
    fj:  ['返回辅警站', 'https://fj.rcj9527.dpdns.org'],
    xf:  ['返回消防站', 'https://xf.955827.xyz']
  };
  var ctxBack = document.getElementById('ctx-back');
  if (ctxBack) {
    var fromP = getParam('from');
    if (CTX[fromP]) {
      ctxBack.textContent = '← ' + CTX[fromP][0];
      ctxBack.href = CTX[fromP][1];
      ctxBack.hidden = false;
    }
  }

  // 岗位预选：来源站用 ?role= 直接调起对应岗位
  var roleParam = getParam('role');
  if (roleParam) {
    var roleSel = document.getElementById('role');
    if (roleSel) {
      var norm = { '消防': '消防员', '消防员': '消防员', '警察': '辅警', '公安': '辅警', '辅警': '辅警' };
      var rv = norm[roleParam] || roleParam;
      var exists = Array.prototype.some.call(roleSel.options, function (o) { return o.value === rv; });
      if (exists) {
        roleSel.value = rv;
        var rh = document.getElementById('role-hint');
        if (rh) { rh.textContent = '已按来源预选：' + rv; rh.className = 'field-hint ok'; }
      }
    }
  }

  function encode(data) {
    try {
      return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    } catch (e) {
      return '';
    }
  }
  function decode(str) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(str))));
    } catch (e) {
      return null;
    }
  }

  // 简单识别会议链接类型
  function meetingType(url) {
    if (/meeting\.tencent\.com/i.test(url)) return '腾讯会议';
    if (/vc\.feishu\.cn|meeting\.feishu\.cn|feishu\.cn\/j/i.test(url)) return '飞书会议';
    return '';
  }

  // ---------- 生成器（首页） ----------
  var form = document.getElementById('gen-form');
  if (form) {
    var meetingInput = document.getElementById('meeting');
    var meetingHint = document.getElementById('meeting-hint');

    meetingInput.addEventListener('input', function () {
      var t = meetingType(meetingInput.value.trim());
      if (t) {
        meetingHint.textContent = '已识别：' + t;
        meetingHint.className = 'field-hint ok';
      } else if (meetingInput.value.trim()) {
        meetingHint.textContent = '暂未识别为腾讯会议 / 飞书会议链接，仍可继续';
        meetingHint.className = 'field-hint warn';
      } else {
        meetingHint.textContent = '支持腾讯会议 / 飞书会议链接';
        meetingHint.className = 'field-hint';
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var meeting = meetingInput.value.trim();
      if (!meeting) {
        alert('请先粘贴会议链接');
        return;
      }
      var data = {
        meeting: meeting,
        type: meetingType(meeting),
        role: document.getElementById('role').value,
        city: document.getElementById('city').value.trim(),
        time: document.getElementById('time').value.trim(),
        when: document.getElementById('when').value,
        contactType: document.getElementById('contactType').value,
        contact: document.getElementById('contact').value.trim(),
        note: document.getElementById('note').value.trim()
      };
      var fromQ = getParam('from');
      var matchBase = '/match.html' + (fromQ ? ('?from=' + encodeURIComponent(fromQ)) : '');
      var enc = encode(data);
      var url = location.origin + matchBase + '#d=' + enc;

      var result = document.getElementById('result');
      var resultUrl = document.getElementById('result-url');
      var previewLink = document.getElementById('preview-link');
      resultUrl.value = url;
      previewLink.href = matchBase + '#d=' + enc;
      result.hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    document.getElementById('copy-btn').addEventListener('click', function () {
      copyText(document.getElementById('result-url').value, this, '复制');
    });
  }

  // ---------- 匹配页 ----------
  var matchBase = '/match.html' + (getParam('from') ? ('?from=' + encodeURIComponent(getParam('from'))) : '');

  // 互评结果卡（#f=）
  if (location.hash.indexOf('#f=') === 0) {
    var fb = decode(location.hash.slice(3));
    if (fb && fb.scores) {
      var DIMS = [
        ['logic', '逻辑清晰'], ['express', '表达流畅'],
        ['manner', '仪态得体'], ['content', '内容充实']
      ];
      document.getElementById('fb-role').textContent = (fb.role || '搭子') + (fb.city ? ' · ' + fb.city : '');
      document.getElementById('fb-by').textContent = '来自：' + (fb.by || '匿名搭子');
      var ul = document.getElementById('fb-scores');
      ul.innerHTML = '';
      DIMS.forEach(function (d) {
        var v = Number(fb.scores[d[0]]) || 0;
        var stars = '';
        for (var i = 1; i <= 5; i++) stars += (i <= v ? '★' : '☆');
        var li = document.createElement('li');
        li.innerHTML = '<span class="mi-k">' + d[1] + '</span><span class="mi-v">' + stars + ' <em>' + v + '</em></span>';
        ul.appendChild(li);
      });
      var sb = document.getElementById('fb-suggest-box');
      if (fb.suggest) {
        document.getElementById('fb-suggest-text').textContent = fb.suggest;
        sb.hidden = false;
      }
      document.getElementById('fb-result').hidden = false;
    } else {
      document.getElementById('match-empty').hidden = false;
    }
  } else if (location.hash.indexOf('#d=') === 0) {
    var d = decode(location.hash.slice(3));
    var card = document.getElementById('match-card');
    var empty = document.getElementById('match-empty');
    if (d && d.meeting) {
      document.getElementById('m-role').textContent = d.role || '岗位';
      document.getElementById('m-city').textContent = d.city || '待定';
      document.getElementById('m-time').textContent = d.time || '待定';
      document.getElementById('m-note').textContent = d.note || '—';
      var join = document.getElementById('m-join');
      join.href = d.meeting;
      join.textContent = (d.type ? d.type : '会议') + ' 一键入会 →';

      var contactBox = document.getElementById('m-contact');
      if (d.contact) {
        document.getElementById('m-contact-type').textContent = d.contactType || '联系方式';
        document.getElementById('m-contact-value').textContent = d.contact;
        contactBox.hidden = false;
      }
      document.getElementById('m-copy').addEventListener('click', function () {
        if (d.contact) copyText(d.contact, this, '复制');
      });

      // 倒计时 + 加日历
      if (d.when) {
        var whenLi = document.getElementById('m-when-li');
        var cd = document.getElementById('m-countdown');
        var calBtn = document.getElementById('m-cal');
        whenLi.hidden = false;
        calBtn.hidden = false;
        var target = new Date(d.when).getTime();
        function tick() {
          var diff = target - Date.now();
          if (diff <= 0) {
            cd.textContent = '已开练 / 进行中';
            return;
          }
          var s = Math.floor(diff / 1000);
          var dd = Math.floor(s / 86400); s -= dd * 86400;
          var hh = Math.floor(s / 3600); s -= hh * 3600;
          var mm = Math.floor(s / 60); var ss = s - mm * 60;
          cd.textContent = (dd ? dd + '天 ' : '') + pad(hh) + ':' + pad(mm) + ':' + pad(ss);
        }
        tick();
        setInterval(tick, 1000);
        calBtn.addEventListener('click', function () { downloadICS(d); });
      }

      // 写互评
      document.getElementById('m-fb').addEventListener('click', function () {
        var p = document.getElementById('fb-panel');
        p.hidden = !p.hidden;
        if (!p.hidden) p.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      document.getElementById('fb-submit').addEventListener('click', function () {
        var scores = {};
        Array.prototype.forEach.call(document.querySelectorAll('#fb-panel select[data-dim]'), function (sel) {
          scores[sel.getAttribute('data-dim')] = Number(sel.value);
        });
        var fbData = {
          role: d.role, city: d.city,
          scores: scores,
          suggest: document.getElementById('fb-suggest').value.trim(),
          by: document.getElementById('fb-by').value.trim()
        };
        var furl = location.origin + matchBase + '#f=' + encode(fbData);
        var out = document.getElementById('fb-out');
        document.getElementById('fb-url').value = furl;
        out.hidden = false;
        out.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      document.getElementById('fb-copy').addEventListener('click', function () {
        copyText(document.getElementById('fb-url').value, this, '复制');
      });

      // 录音复盘
      document.getElementById('m-rec').addEventListener('click', function () {
        var p = document.getElementById('rec-panel');
        p.hidden = !p.hidden;
        if (!p.hidden) p.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      initRecorder();

      card.hidden = false;
      if (isWeChat) document.getElementById('wx-tip').hidden = false;
    } else {
      empty.hidden = false;
    }
  } else if (document.getElementById('match-empty')) {
    document.getElementById('match-empty').hidden = false;
  }

  // ---------- .ics 日历 ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function downloadICS(d) {
    try {
      var start = new Date(d.when);
      var end = new Date(start.getTime() + 60 * 60 * 1000);
      function fmt(dt) {
        return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      }
      var desc = '会议链接：' + d.meeting + '\\n';
      if (d.contact) desc += '联系：' + (d.contactType || '') + ' ' + d.contact + '\\n';
      if (d.note) desc += '备注：' + d.note + '\\n';
      var ics = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RCJ//mianshi-dazi//CN',
        'BEGIN:VEVENT',
        'UID:' + Date.now() + '@mianshi.rcj9527',
        'DTSTAMP:' + fmt(new Date()),
        'DTSTART:' + fmt(start),
        'DTEND:' + fmt(end),
        'SUMMARY:面试搭子互练 · ' + (d.role || '') + (d.city ? ' · ' + d.city : ''),
        'DESCRIPTION:' + desc,
        'URL:' + d.meeting,
        'END:VEVENT', 'END:VCALENDAR'
      ].join('\r\n');
      var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '面试搭子互练.ics';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert('日历生成失败，请手动记录开练时间。');
    }
  }

  // ---------- 录音 + 口语分析 ----------
  function initRecorder() {
    var toggle = document.getElementById('rec-toggle');
    var live = document.getElementById('rec-live');
    var out = document.getElementById('rec-out');
    var desc = document.getElementById('rec-desc');
    if (!toggle) return;

    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      desc.textContent = '当前浏览器不支持语音识别（建议用 Chrome / Edge 桌面端；微信内请点右上角「在浏览器打开」）。你仍可用腾讯会议自带的录制功能复盘。';
      toggle.disabled = true;
      toggle.textContent = '不支持录音分析';
      return;
    }

    var rec = null, recording = false, transcript = '', t0 = 0;
    var FILLERS = ['嗯', '那个', '然后', '就是', '呃', '啊', '嘛', '的话', '对吧'];

    toggle.addEventListener('click', function () {
      if (!recording) {
        startRec();
      } else {
        recording = false;
        if (rec) rec.stop();
      }
    });

    function startRec() {
      try {
        rec = new SR();
      } catch (e) {
        desc.textContent = '无法启动语音识别，请检查浏览器麦克风权限。';
        return;
      }
      rec.lang = 'zh-CN';
      rec.interimResults = true;
      rec.continuous = true;
      transcript = '';
      t0 = Date.now();
      recording = true;
      toggle.textContent = '停止录音 ■';
      toggle.classList.add('recording');
      live.hidden = false;
      live.textContent = '（听着呢…对着麦克风答题吧）';
      out.hidden = true;

      rec.onresult = function (e) {
        var interim = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var r = e.results[i];
          if (r.isFinal) transcript += r[0].transcript;
          else interim += r[0].transcript;
        }
        live.textContent = (transcript + interim) || '（听着呢…）';
      };
      rec.onerror = function (ev) {
        if (ev.error === 'not-allowed') {
          desc.textContent = '麦克风权限被拒绝，请在浏览器地址栏允许麦克风后重试。';
          recording = false;
          toggle.textContent = '开始录音';
          toggle.classList.remove('recording');
        }
      };
      rec.onend = function () {
        if (recording) { try { rec.start(); } catch (e) {} return; }
        finishRec();
      };
      try { rec.start(); } catch (e) {}
    }

    function finishRec() {
      toggle.textContent = '开始录音';
      toggle.classList.remove('recording');
      var durMin = (Date.now() - t0) / 60000;
      var text = transcript.replace(/\s/g, '');
      var chars = text.length;
      var wpm = durMin > 0 ? Math.round(chars / durMin) : 0;

      var counts = {};
      FILLERS.forEach(function (f) {
        var n = text.split(f).length - 1;
        if (n > 0) counts[f] = n;
      });
      var totalFill = Object.keys(counts).reduce(function (a, k) { return a + counts[k]; }, 0);

      var tips = [];
      if (chars === 0) {
        tips.push('没识别到语音，可能是环境太吵或麦克风未授权，换个安静环境重试。');
      } else {
        if (wpm < 120) tips.push('语速偏慢（' + wpm + ' 字/分），可适当加快，避免冷场。');
        else if (wpm > 260) tips.push('语速偏快（' + wpm + ' 字/分），考官可能跟不上，注意停顿。');
        else tips.push('语速适中（' + wpm + ' 字/分），保持这个节奏。');
        if (totalFill >= 6) tips.push('填充词出现 ' + totalFill + ' 次，偏多，可用短停顿代替「嗯 / 那个」。');
        else if (totalFill > 0) tips.push('填充词 ' + totalFill + ' 次，整体可控，继续留意即可。');
        else tips.push('几乎没用填充词，表达很干净，赞。');
      }

      var html = '<div class="rec-stat"><span>时长</span><b>' + durMin.toFixed(1) + ' 分</b></div>'
        + '<div class="rec-stat"><span>有效字数</span><b>' + chars + ' 字</b></div>'
        + '<div class="rec-stat"><span>语速</span><b>' + wpm + ' 字/分</b></div>'
        + '<div class="rec-stat"><span>填充词</span><b>' + totalFill + ' 次</b></div>';
      if (totalFill > 0) {
        html += '<p class="rec-fill">填充词明细：' + Object.keys(counts).map(function (k) {
          return k + '×' + counts[k];
        }).join('，') + '</p>';
      }
      html += '<div class="rec-tips"><b>改进建议</b><ul>' + tips.map(function (t) {
        return '<li>' + t + '</li>';
      }).join('') + '</ul></div>';
      if (text) {
        html += '<details class="rec-trans"><summary>查看识别文本</summary><p>' + escapeHtml(text) + '</p></details>';
      }
      out.innerHTML = html;
      out.hidden = false;
      out.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  // ---------- 通用复制 ----------
  function copyText(text, btn, label) {
    var done = function () {
      var old = btn.textContent;
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
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  }
})();
