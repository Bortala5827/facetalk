// 面试搭子 MVP —— 纯前端：数据编码进 URL hash，无后端
(function () {
  'use strict';

  var isWeChat = /micromessenger/i.test(navigator.userAgent);

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
        contactType: document.getElementById('contactType').value,
        contact: document.getElementById('contact').value.trim(),
        note: document.getElementById('note').value.trim()
      };
      var url = location.origin + '/match.html#d=' + encode(data);

      var result = document.getElementById('result');
      var resultUrl = document.getElementById('result-url');
      var previewLink = document.getElementById('preview-link');
      resultUrl.value = url;
      previewLink.href = '/match.html#d=' + encode(data);
      result.hidden = false;
      result.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    document.getElementById('copy-btn').addEventListener('click', function () {
      var url = document.getElementById('result-url').value;
      copyText(url, this, '复制');
    });
  }

  // ---------- 匹配页 ----------
  if (location.hash.indexOf('#d=') === 0) {
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

      card.hidden = false;
      if (isWeChat) document.getElementById('wx-tip').hidden = false;
    } else {
      empty.hidden = false;
    }
  } else if (document.getElementById('match-empty')) {
    document.getElementById('match-empty').hidden = false;
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
