// ============================================================
// FaceTalk v2.1 面试间逻辑
// 依赖 window.FT（me / pairId / toast / esc / setRemain / remain）与 window.FTSettings
//   - 计时跟随搭子房间总时长（单场上限 10 分钟），时间到自动 AI 评价；超过 10 分钟请跳转腾讯会议/飞书会议继续对练
//   - 实时转录：我方用 MediaRecorder 分段 → 用户自带的 Whisper 接口转文字 → 写入面试间，双方同步
//   - 原生 WebRTC 语音（信令走 /api/interview，无 TURN 时回落腾讯会议）
//   - 结束 → 用用户自带大模型对完整对话稿做结构化评价
// ============================================================
(function () {
  if (!window.FT || !window.FT.me || !window.FT.pairId) return;
  var me = window.FT.me, pairId = window.FT.pairId;
  var esc = window.FT.esc, toast = window.FT.toast;
  var t = function (k, a) { return window.FTI18N ? window.FTI18N.t(k, a) : k; };

  var $ = function (id) { return document.getElementById(id); };

  // 元素（v2.3 删掉 iv-setup / iv-start / iv-dur；iv-live 直接显示，所有按钮即时可用）
  var live = $('iv-live'), timerEl = $('iv-timer'),
      needset = $('iv-needset'),
      endBtn = $('iv-end'), sttBtn = $('iv-stt'), callBtn = $('iv-call'),
      transcript = $('iv-transcript'), noteInput = $('iv-note'), noteSend = $('iv-note-send'),
      evalBox = $('iv-eval'), callTip = $('iv-call-tip');
  // 备选会议号元素
  var fbCard = $('iv-fallback'), fbToggle = $('iv-fb-toggle'), fbBody = $('iv-fb-body'),
      fbStatus = $('iv-fb-status'), fbChev = $('iv-fb-chev'),
      fbTen = $('iv-fb-tencent'), fbFei = $('iv-fb-feishu'), fbSave = $('iv-fb-save'),
      fbToast = $('iv-fb-toast'), fbPeer = $('iv-fb-peer'),
      fbPeerTen = $('iv-fb-peer-tencent'), fbPeerFei = $('iv-fb-peer-feishu');

  // 状态（v2.3 取消独立 remainSec/tickTimer，计时与搭子房间共享）
  var active = false, ended = false, evalRequested = false, pollTimer = null;
  var known = {};                 // 已渲染的转录行 id
  var lastSignal = 0;             // 信令轮询游标（秒级，回退 2 秒重叠取，靠 seenSig 去重）
  var seenSig = {};               // 已处理过的信令 id，防重叠区间重复处理
  var pendingOffer = null;        // 对方发起语音但本方还没接听时暂存
  var sttOn = false, sttStream = null, sttRec = null, sttErrShown = false;
  // 浏览器原生 STT（Web Speech API）状态
  var sttBrowser = null, sttBrowserOn = false, sttBrowserLast = '', sttBrowserLastEmit = 0;
  var pc = null, callStream = null, callStarted = false, callConnTimer = null;
  // 备选会议号状态：fbUserOpen=true 表示用户/系统已经把 fallback 卡展开了；false 表示当前是折叠状态
  var fbExpanded = false, fbFilledMine = false, fbLast = { tencent: '', feishu: '' };
  var fbShown = false;            // fallback 卡是否被允许显示（30s 未连通 / 用户手动 / 始终显示策略）
  var fbAutoShown = false;        // 是否因 30s 未连通被自动展开过（连通后再次自动折叠会用到）

  // 隐藏的远端音频（WebRTC）
  var remoteAudio = document.createElement('audio');
  remoteAudio.autoplay = true; remoteAudio.style.display = 'none';
  document.body.appendChild(remoteAudio);

  // 进场即刷新设置提示
  refreshSetupHint();

  // ── 计时：订阅搭子房间共享 remain（v2.3 取消独立计时）──
  // iv-timer 只读不写 — 不自 -1，完全跟搭子房间的 30 分钟倒计时同步
  function paintTimer(n) {
    if (n == null || n < 0) n = 0;
    var m = Math.floor(n / 60), s = n % 60;
    timerEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  // 归零时跑 AI 评价（一次性，evalRequested 防重入）
  function onRemainZero() {
    if (evalRequested) return; evalRequested = true;
    toast(t('ivTimeUp'));
    stopStt();
    if (window.FTSettings && window.FTSettings.hasLLM()) runEval();
    else { toast(t('ivTimeUpEval')); }
  }
  // v2.3：onUnlock 时调，订阅搭子房间倒计时（pair.html 每秒 tick 会 fire 一次）
  var unsubRemain = null;
  var remainListener = function (n) { paintTimer(n); };
  remainListener.onZero = function () { onRemainZero(); };
  function startSharedTimer() {
    if (unsubRemain) return;
    unsubRemain = window.FT.setRemain(remainListener);
  }

  // ── 轮询转录 + 信令 ──
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(poll, 1500);
    poll();
  }
  function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function ivGet(extra) {
    var u = new URL('/api/interview', location.origin);
    u.searchParams.set('me', me); u.searchParams.set('pair', pairId);
    u.searchParams.set('sinceSignal', lastSignal);
    return fetch(u).then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  var pollFailCount = 0;   // 连续失败计数；连续 3 次（约 4.5 秒）才报警，避免抖动
  function poll() {
    ivGet().then(function (d) {
      pollFailCount = 0;
      if (!d || !d.ok) return;
      // 转录行（来自后端，id 是 il_xxx，1.5s 周期拉；own 发送的乐观行通过 known[] 去重，不会重复）
      (d.lines || []).forEach(function (ln) {
        appendLine(ln.mine, ln.text, ln.id, { created: ln.created });
      });
      // 备选会议号（双方的另一面，回执时不是自己的）
      if (d.fallback) applyFallback(d.fallback);
      // WebRTC 信令
      // 注意：created 是秒级，同一秒内可能有多条 ICE。若直接把游标推到 max(created)，
      // 同秒内后到的候选会被 `created > sinceSignal` 永久过滤掉 → 连不通。
      // 所以游标回退 2 秒重叠拉取，靠 seenSig 按 id 去重。
      var maxC = lastSignal;
      (d.signals || []).forEach(function (sg) {
        if (sg.created > maxC) maxC = sg.created;
        if (seenSig[sg.id]) return;
        seenSig[sg.id] = 1;
        if (callStarted) handleSignal(sg);
        else if (sg.kind === 'offer') promptIncomingCall(sg);
      });
      lastSignal = Math.max(0, maxC - 2);
    }).catch(function () {
      // 之前 .catch(function(){}) 静默吞所有 GET 错误：后端拉失败时用户毫无感知，
      // 误以为"消息没发出去"。改成连续 3 次失败（约 4.5 秒）才报警，避免网络抖动假阳性
      pollFailCount++;
      if (pollFailCount === 3) toast(t('ivPollBroken'), true);
    });
  }
  // 渲染一条对话行。key=唯一键（后端 il_xxx / 临时 tmp_xxx），传了同 key 会直接 return。
  // opts.created：秒级时间戳，缺省用本地时间
  // opts.pending：乐观 UI 的「发送中」状态（小圆点呼吸，浅色气泡）
  // opts.failed：发送失败状态（红底气泡 + ⚠ 角标）
  function appendLine(isMine, text, key, opts) {
    if (!text) return;
    opts = opts || {};
    if (key && known[key]) return;
    if (key) known[key] = 1;
    var who = isMine ? t('msgMine') : t('msgPeer');
    var empty = transcript.querySelector('p.muted'); if (empty) empty.remove();
    var div = document.createElement('div');
    div.className = 'iv-msg ' + (isMine ? 'iv-mine' : 'iv-peer')
      + (opts.pending ? ' iv-pending' : '')
      + (opts.failed ? ' iv-fail' : '');
    if (key) div.setAttribute('data-ivkey', key);
    var ts = opts.created || Math.floor(Date.now() / 1000);
    var t = new Date(1000 * ts);
    var hh = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
    var pendingHtml = opts.pending ? ' <span class="iv-pending-dot">…</span>' : '';
    var failedHtml = opts.failed ? ' <span class="iv-fail-tag">⚠ ' + t('ivSendFailShort') + '</span>' : '';
    div.innerHTML =
      '<div class="iv-bubble-wrap">' +
        '<div class="iv-bubble">' + esc(text) + pendingHtml + '</div>' +
        '<div class="iv-meta">' + esc(who) + ' · ' + hh + failedHtml + '</div>' +
      '</div>';
    transcript.appendChild(div);
    transcript.scrollTop = transcript.scrollHeight;
  }

  // ── 备选会议号（fallback 卡）──
  // 渲染规则：
  //  - 后端给的是「对方的面」：我自己填的存在本地 input，不让服务器回显覆盖
  //  - 顶部摘要条里的状态：自己是否填过、对方是否填过
  //  - 控制：默认折叠；30s 未连通自动展开（标记 fbAutoShown），连通成功后自动再次折叠
  //  - 用户手动展开/折叠会清除 fbAutoShown 标记，避免系统再覆盖其意图
  function applyFallback(other) {
    var peerT = (other && other.tencent) || '';
    var peerF = (other && other.feishu) || '';
    var changed = false;
    if (peerT !== fbLast.tencent || peerF !== fbLast.feishu) {
      fbLast.tencent = peerT;
      fbLast.feishu = peerF;
      changed = true;
    }
    if (changed) renderFallbackStatus();
  }
  function renderFallbackStatus() {
    if (!fbCard) return;
    fbCard.hidden = !fbShown;
    // 我这边是否填过
    var mineHas = !!(fbTen && fbTen.value.trim()) || !!(fbFei && fbFei.value.trim());
    fbFilledMine = mineHas;
    var peerT = fbLast.tencent.trim(), peerF = fbLast.feishu.trim();
    var peerHas = !!(peerT || peerF);
    // 摘要条文案
    if (!mineHas && !peerHas) { fbStatus.textContent = t('ivFbStatusNone'); fbStatus.className = 'iv-fb-status none'; }
    else if (mineHas && !peerHas) { fbStatus.textContent = t('ivFbStatusMine'); fbStatus.className = 'iv-fb-status wait'; }
    else if (!mineHas && peerHas) { fbStatus.textContent = t('ivFbStatusPeer'); fbStatus.className = 'iv-fb-status wait'; }
    else { fbStatus.textContent = t('ivFbStatusBoth'); fbStatus.className = 'iv-fb-status ok'; }
    fbChev.textContent = fbExpanded ? '▾' : '▸';
    fbToggle.setAttribute('aria-expanded', fbExpanded ? 'true' : 'false');
    fbBody.hidden = !fbExpanded;
    // 对方填的：放在卡里给双方看，不能编辑
    var showPeer = peerHas && fbExpanded;
    fbPeer.hidden = !showPeer;
    if (showPeer) {
      fbPeerTen.textContent = peerT ? (t('ivFbTencentLabel') + peerT) : t('ivFbTencentEmpty');
      fbPeerFei.textContent = peerF ? (t('ivFbFeishuLabel') + peerF) : t('ivFbFeishuEmpty');
      fbPeerTen.className = peerT ? '' : 'muted';
      fbPeerFei.className = peerF ? '' : 'muted';
    }
    // 已经填过的，不再清空 input（极简：用 value 持有）
    if (mineHas) {
      if (fbTen && !fbTen.dataset.touched) fbTen.value = fbTen.value;
      if (fbFei && !fbFei.dataset.touched) fbFei.value = fbFei.value;
    }
  }
  function fbSetExpanded(open, fromAuto) {
    if (!fbCard || fbCard.hidden) { fbExpanded = false; return; }
    fbExpanded = !!open;
    if (!fromAuto) fbAutoShown = false;   // 用户主动操作：接管，不再被系统自动折叠
    renderFallbackStatus();
  }
  function fbEnsureShown() { fbShown = true; if (fbCard) { fbCard.hidden = false; renderFallbackStatus(); } }
  function fbAutoExpand() { if (!fbCard) return; fbEnsureShown(); fbAutoShown = true; fbSetExpanded(true, true); }
  function fbAutoCollapseIfAuto() {
    if (!fbCard) return;
    if (fbAutoShown && !fbLast.tencent && !fbLast.feishu && !fbFilledMine) {
      // 自动展开是为应急、自动收回条件：双方都没填、用户没主动操作
      fbSetExpanded(false, true);
    } else if (fbAutoShown && pc && pc.connectionState === 'connected') {
      // 连通后自动收回
      fbSetExpanded(false, true);
    }
  }
  // 失败 / 超时的升级提醒：30 秒后自动滚动到备选会议号卡，并高亮提示填腾讯/飞书会议号
  var fbEscTimer = null;
  function showFbReminder() {
    var r = document.getElementById('iv-fb-reminder');
    if (r) r.hidden = false;
    if (fbChev) fbChev.textContent = '▾';
    if (fbCard) {
      fbCard.classList.add('iv-fb-flash');
      setTimeout(function () { if (fbCard) fbCard.classList.remove('iv-fb-flash'); }, 2400);
    }
  }
  function hideFbReminder() {
    var r = document.getElementById('iv-fb-reminder');
    if (r) r.hidden = true;
  }
  function fbEscalateAfter30s() {
    if (fbEscTimer) return;
    fbEscTimer = setTimeout(function () {
      fbEscTimer = null;
      if (pc && pc.connectionState === 'connected') return;   // 已经连上就不用跳了
      fbAutoExpand();                                          // 确保卡展开了
      if (fbCard) fbCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      showFbReminder();                                        // 高亮 + 填号提醒
    }, 30000);
  }
  function clearFbEscalation() {
    if (fbEscTimer) { clearTimeout(fbEscTimer); fbEscTimer = null; }
    hideFbReminder();
  }

  if (fbToggle) {
    fbToggle.addEventListener('click', function () { fbSetExpanded(!fbExpanded, false); });
    [fbTen, fbFei].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', function () { el.dataset.touched = '1'; renderFallbackStatus(); });
    });
    if (fbSave) {
      fbSave.addEventListener('click', function () {
        var t = (fbTen && fbTen.value || '').replace(/\s+/g, ' ').trim();
        var f = (fbFei && fbFei.value || '').replace(/\s+/g, ' ').trim();
        if (!t && !f) { fbToast.textContent = t('ivFbAtLeastOne'); setTimeout(function () { fbToast.textContent = ''; }, 1500); return; }
        fbSave.disabled = true;
        fetch('/api/interview', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ me: me, pair: pairId, action: 'set-fallback', tencent: t, feishu: f }),
        }).then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (d) {
            fbSave.disabled = false;
            if (d && d.ok) {
              fbToast.textContent = t('ivFbSaved');
              setTimeout(function () { fbToast.textContent = ''; }, 1500);
              renderFallbackStatus();
            } else {
              fbToast.textContent = t('ivFbSaveFail') + (d.error || t('ivUnknown'));
            }
          })
          .catch(function () { fbSave.disabled = false; fbToast.textContent = t('ivFbSaveFail'); });
      });
    }
  }

  // ── 手动补充 ──
  // 乐观 UI：点完按钮立刻在对话稿画一条「发送中…」的气泡，POST 回来成功去掉圆点 + 移除气泡内 ... span、记 il_xxx 到 known
  // 防止 1.5s 后的轮询重画同一条；失败则去掉圆点 + 移除 ... span、加红底 + ⚠ + 重发按钮 + toast
  // 10 秒超时：网络真挂时主动标记失败（避免「永远卡在发送中」的体验）
  function clearPending(el) {
    if (!el) return;
    el.classList.remove('iv-pending');
    var dot = el.querySelector('.iv-pending-dot');
    if (dot) dot.remove();
  }
  function markFailed(el, reason) {
    if (!el) return;
    clearPending(el);
    el.classList.add('iv-fail');
    var meta = el.querySelector('.iv-meta');
    if (meta && !meta.querySelector('.iv-fail-tag')) {
      var tag = document.createElement('span');
      tag.className = 'iv-fail-tag';
      tag.textContent = '⚠ ' + t('ivSendFailShort');
      meta.appendChild(tag);
      var btn = document.createElement('button');
      btn.className = 'iv-retry';
      btn.type = 'button';
      btn.textContent = '🔄 ' + t('ivRetry');
      btn.addEventListener('click', function () {
        var text = el.querySelector('.iv-bubble').textContent.replace(/…/g, '').trim();
        el.remove();
        if (known[tmpKey]) delete known[tmpKey];
        noteInput.value = text;
        sendNote();
      });
      meta.appendChild(btn);
    }
    toast(reason || t('ivSendFailShort'), true);
  }
  function sendNote() {
    var v = noteInput.value.replace(/\s+/g, ' ').trim();
    if (!v) return;
    noteInput.value = '';
    var tmpKey = 'tmp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    appendLine(true, v, tmpKey, { pending: true, created: Math.floor(Date.now() / 1000) });
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 10000) : null;   // 10s 超时
    fetch('/api/interview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ me: me, pair: pairId, action: 'line', text: v }),
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.json().catch(function () { return {}; });
    }).then(function (d) {
      var el = transcript.querySelector('[data-ivkey="' + tmpKey + '"]');
      if (d && d.ok) {
        if (d.id) known[d.id] = 1;     // 防止 1.5s 后 polling 把同一条再画一次
        if (el) { clearPending(el); el.setAttribute('data-ivkey', d.id || tmpKey); }
      } else {
        markFailed(el, t('ivSendFailReason') + (d && d.error || t('ivUnknown')));
      }
    }).catch(function (e) {
      if (timer) clearTimeout(timer);
      var el = transcript.querySelector('[data-ivkey="' + tmpKey + '"]');
      markFailed(el, e && e.name === 'AbortError' ? t('ivSendTimeout') : t('ivSendNetErr'));
    });
  }
  noteSend.addEventListener('click', sendNote);
  noteInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') sendNote(); });

  // ── 录音转文字（STT）──
  // 三种模式：
  //   api     → MediaRecorder 每 20 秒产一段，发到用户自带的 Whisper 兼容接口转写（路径 1，老逻辑）
  //   browser → 浏览器原生 SpeechRecognition（continuous + interimResults），适合不想配 API 的电脑用户
  //   off     → 完全关闭，靠手动记笔记
  function pickMime() {
    var c = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
    for (var i = 0; i < c.length; i++) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(c[i])) return c[i]; } catch (e) {} }
    return '';
  }
  function toggleStt() {
    if (sttOn || sttBrowserOn) { stopStt(); return; }
    if (!window.FTSettings || !window.FTSettings.sttOn()) {
      toast(t('ivSttNeedSetup'), true);
      if (window.FTSettings) window.FTSettings.open();
      return;
    }
    var mode = (window.FTSettings && window.FTSettings.sttMode) || 'api';
    if (mode === 'browser') startSttBrowser();
    else startSttApi();
  }
  function startSttApi() {
    if (!window.FTSettings || !window.FTSettings.hasSTT()) {
      toast(t('ivNeedCfg'), true);
      if (window.FTSettings) window.FTSettings.open();
      return;
    }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      toast(t('ivNoMediaRec'), true); return;
    }
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      .then(function (s) {
        sttStream = s; sttErrShown = false;
        var mt = pickMime();
        try { sttRec = new MediaRecorder(s, mt ? { mimeType: mt, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 }); }
        catch (e) { try { sttRec = new MediaRecorder(s); } catch (e2) { toast(t('ivRecFail'), true); return; } }
        sttRec.ondataavailable = function (e) { if (e.data && e.data.size) sttSend(e.data); };
        sttRec.start(20000);   // 每 20 秒产出一段，增量转写
        sttOn = true; updateSttBtn();
        toast(t('ivSttOnApi'));
      })
      .catch(function () { toast(t('ivMicDenied'), true); });
  }
  function startSttBrowser() {
    // 浏览器原生 STT：必须先拿麦克风（Chrome 强制要求），再启 SpeechRecognition
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast(t('ivNoMic'), true); return;
    }
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast(t('ivNoSR'), true); return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
      // 立刻停掉流：SpeechRecognition 自管麦克风，长期占着会让用户以为录音灯常亮
      s.getTracks().forEach(function (t) { t.stop(); });
      sttBrowser = new SR();
      sttBrowser.continuous = true;
      sttBrowser.interimResults = true;
      sttBrowser.lang = (window.FTSettings && window.FTSettings.browserSttLang) ? window.FTSettings.browserSttLang() : 'zh-CN';
      sttBrowserLast = '';
      sttBrowserLastEmit = 0;
      // 兼容：onresult 一次返回多个 result（含 isFinal=false 的和 isFinal=true 的）
      sttBrowser.onresult = function (e) {
        var finalText = '';
        for (var i = e.resultIndex; i < e.results.length; i++) {
          var r = e.results[i];
          if (r.isFinal) finalText += (finalText ? '\n' : '') + r[0].transcript.trim();
        }
        if (!finalText) return;
        var t = finalText.replace(/\s+/g, ' ').trim();
        if (!t || t === sttBrowserLast) return;
        sttBrowserLast = t;
        // 同一秒内多次 final 结果不会重复发送
        var now = Date.now();
        if (now - sttBrowserLastEmit < 500) return;
        sttBrowserLastEmit = now;
        fetch('/api/interview', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ me: me, pair: pairId, action: 'line', text: t }),
        }).catch(function () {});
      };
      sttBrowser.onerror = function (e) {
        if (!sttErrShown) { sttErrShown = true; toast(t('ivSttErr') + (e.error || t('ivUnknown')) + t('ivSttErrCheck'), true); }
      };
      sttBrowser.onend = function () {
        // 用户停掉、Chrome 长时间没声音会自动 end；这时只有"开着"才续
        if (sttBrowserOn) {
          try { sttBrowser.start(); } catch (e) {}
        }
      };
      try {
        sttBrowser.start();
        sttBrowserOn = true; sttOn = true; sttErrShown = false;
        updateSttBtn();
        toast(t('ivSttOnBrowser'));
      } catch (e) { toast(t('ivSttStartFail'), true); }
    }).catch(function () { toast(t('ivMicDenied'), true); });
  }
  function stopStt() {
    if (sttRec) { try { if (sttRec.state !== 'inactive') sttRec.stop(); } catch (e) {} sttRec = null; }
    if (sttStream) { sttStream.getTracks().forEach(function (t) { t.stop(); }); sttStream = null; }
    if (sttBrowser) { sttBrowserOn = false; try { sttBrowser.onend = null; sttBrowser.stop(); } catch (e) {} sttBrowser = null; }
    sttOn = false; updateSttBtn();
  }
  function updateSttBtn() {
    var on = sttOn || sttBrowserOn;
    sttBtn.textContent = on ? t('ivSttOn') : t('ivSttOff');
    sttBtn.classList.toggle('on', !!on);
  }
  function sttSend(blob) {
    var cfg = window.FTSettings.get();
    var base = (cfg.sttBase || cfg.llmBase || '').trim();
    var key = (cfg.sttKey || cfg.llmKey || '').trim();
    var model = (cfg.sttModel || '').trim();
    if (!base || !key || !model) return;
    var fd = new FormData();
    fd.append('file', blob, 'seg.webm');
    fd.append('base', base); fd.append('key', key); fd.append('model', model);
    fetch('/api/llm?type=transcribe', { method: 'POST', body: fd })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (d.ok && d.text) {
          var t = d.text.trim();
          if (t) fetch('/api/interview', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ me: me, pair: pairId, action: 'line', text: t }),
          }).catch(function () {});
        } else if (!sttErrShown) {
          sttErrShown = true;
          toast(t('ivTransFail') + (d.error || d.status || t('ivUnknown')) + t('ivTransFailCheck'), true);
        }
      })
      .catch(function (e) { if (!sttErrShown) { sttErrShown = true; toast(t('ivTransReqErr'), true); } });
  }
  sttBtn.addEventListener('click', toggleStt);

  // ── 原生 WebRTC 语音 ──
  // STUN：国内优先（Google 的 stun.l.google.com 在境内 UDP 基本不通，只留作海外兜底）
  var BASE_ICE = [
    { urls: 'stun:stun.miwifi.com:3478' },        // 小米，境内稳定
    { urls: 'stun:stun.chat.bilibili.com:3478' }, // B站
    { urls: 'stun:stun.qq.com:3478' },            // 腾讯
    { urls: 'stun:stun.cloudflare.com:3478' },    // CF Anycast
    { urls: 'stun:stun.l.google.com:19302' },     // 海外兜底
  ];
  var ICE = { iceServers: BASE_ICE.slice(), iceCandidatePoolSize: 2 };
  var gotSrflx = false;   // 是否拿到过公网映射候选（没有 = NAT 穿透没戏）
  var turnOn = false;     // 是否成功挂上 TURN 中继

  // TURN 中继凭证：向 /api/turn 换一份 TTL 到期即失效的短期凭证。
  // 后台没配 TURN Key 时接口返回 configured:false，这里静默退回纯 STUN，功能不受影响。
  // 只取一次，取完缓存；超过 3 秒没结果就先用 STUN 起连，不让用户干等。
  var turnState = 0, turnWaiters = [];   // 0 未取 / 1 取中 / 2 已完成
  function withIce(cb) {
    if (turnState === 2) return cb();
    turnWaiters.push(cb);
    if (turnState === 1) return;
    turnState = 1;
    var settled = false;
    var done = function () {
      if (settled) return; settled = true; turnState = 2;
      var w = turnWaiters; turnWaiters = [];
      w.forEach(function (f) { try { f(); } catch (e) {} });
    };
    var timer = setTimeout(done, 3000);
    fetch('/api/turn').then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.configured && d.iceServers && d.iceServers.length) {
        ICE.iceServers = d.iceServers.concat(BASE_ICE);
        turnOn = true;
      }
    }).catch(function () {}).then(function () { clearTimeout(timer); done(); });
  }

  // 统一创建 PeerConnection，两条路径（发起 / 应答）共用，避免逻辑漂移
  function newPC(onFail) {
    var p = new RTCPeerConnection(ICE);
    p.onicecandidate = function (e) {
      if (!e.candidate) return;
      var c = e.candidate.candidate || '';
      if (c.indexOf('typ srflx') >= 0 || c.indexOf('typ relay') >= 0) gotSrflx = true;
      postSignal('ice', JSON.stringify(e.candidate));
    };
    p.ontrack = function (e) { try { remoteAudio.srcObject = e.streams[0]; } catch (e2) {} };
    p.onconnectionstatechange = function () {
      if (p.connectionState === 'connected') {
        if (callConnTimer) { clearTimeout(callConnTimer); callConnTimer = null; }
        callBtn.textContent = t('ivConnected'); callTip.hidden = true;
        clearFbEscalation();       // 连通了就取消 30s 跳转与提醒
        fbAutoCollapseIfAuto();   // 连通后如果之前是自动展开的，就自动收回（用户主动展开过的不会被收回）
      } else if (p.connectionState === 'failed' || p.connectionState === 'disconnected') {
        if (callConnTimer) { clearTimeout(callConnTimer); callConnTimer = null; }
        onFail(turnOn
          ? t('ivDisconnected')
          : (gotSrflx
            ? t('ivNoDirect')
            : t('ivNoPublic')));
        // 直连失败时立刻展开 fallback，应急换走腾讯会议
        fbAutoExpand();
      }
    };
    return p;
  }
  callBtn.addEventListener('click', function () {
    if (callStarted) { stopCall(); return; }
    startCall();
  });
  function postSignal(kind, data) {
    fetch('/api/interview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ me: me, pair: pairId, action: 'signal', kind: kind, data: data }),
    }).catch(function () {});
  }
  function ensureLocalStream(cb) {
    if (callStream) return cb(callStream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      failCall(t('ivNoMic2'));
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) { callStream = s; cb(s); })
      .catch(function (err) {
        var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        failCall(denied
          ? t('ivMicDenied2')
          : t('ivNoMic3'));
      });
  }
  function startCall() {
    callStarted = true; callBtn.textContent = t('ivConnecting'); callBtn.classList.add('on');
    callTip.hidden = true;
    // 30 秒未连通 → 兜底：自动展开「备选会议号」卡，让用户把腾讯/飞书会议号填上，转走外部通话。
    // 节流设计：5~8 秒才在 UI 上出现 log（callTip 一直可见，便于看进度），到 30s 强制展开 fallback。
    // 已经 connected 时由 onconnectionstatechange 清掉计时器。
    if (callConnTimer) { clearTimeout(callConnTimer); callConnTimer = null; }
    callConnTimer = setTimeout(function () {
      if (pc && pc.connectionState === 'connected') return;
      toast(t('ivCall30s'), true);
      fbEscalateAfter30s();
    }, 30000);
    // 若对方已经发过 offer，本方直接走应答路径，不要再互发 offer（会 glare 冲突）
    if (pendingOffer) { var o = pendingOffer; pendingOffer = null; handleSignal(o); return; }
    withIce(function () {
      ensureLocalStream(function (s) {
        try { pc = newPC(failCall); } catch (e) { failCall(t('ivWebRtcUnsupported')); return; }
        s.getTracks().forEach(function (t) { pc.addTrack(t, s); });
        pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () {
          postSignal('offer', JSON.stringify(pc.localDescription));
        }).catch(function () { failCall(t('ivOfferFail')); });
      });
    });
  }
  function handleSignal(sg) {
    if (sg.kind === 'offer') {
      if (pc) {
        // glare：双方几乎同时点了「实时语音」时，两端都建了 pc、都发了 offer。
        // 原代码这里会静默丢弃对方的 offer，导致两端都等不到 answer 一直卡在"连接中"。
        // 决策在 assets/glare.js（纯函数，Node 与浏览器共用），便于单测。
        var decision = window.decideGlare(me, sg.from);
        if (decision === 'ignore-self') {
          // 对方字典序更小 → 对方会 roll back；我保持发起方，忽略这次 offer
          return;
        }
        // roll-back-self：对方字典序更大 → 对方保持发起方；我放弃自己的，改应答
        try { pc.close(); } catch (e) {}
        pc = null;
      }
      // 收到对方 offer：补建本地流并应答（同样要先备好中继凭证，否则应答侧只有 STUN 候选）
      withIce(function () {
        ensureLocalStream(function (s) {
          try { pc = newPC(failCall); } catch (e) { return; }
          s.getTracks().forEach(function (t) { pc.addTrack(t, s); });
          callStarted = true; callBtn.classList.add('on'); callBtn.textContent = t('ivConnecting');
          pc.setRemoteDescription(JSON.parse(sg.data)).then(function () { return pc.createAnswer(); })
            .then(function (a) { return pc.setLocalDescription(a); }).then(function () { postSignal('answer', JSON.stringify(pc.localDescription)); })
            .catch(function () {});
        });
      });
      return;
    }
    if (!pc) return;
    try {
      if (sg.kind === 'answer') pc.setRemoteDescription(JSON.parse(sg.data));
      else if (sg.kind === 'ice') pc.addIceCandidate(JSON.parse(sg.data)).catch(function () {});
    } catch (e) {}
  }
  // 对方先点了「实时语音」，本方还没点：给出接听提示，避免一方干等连不上
  function promptIncomingCall(sg) {
    pendingOffer = sg;
    callTip.hidden = false;
    callTip.innerHTML = t('ivIncomingToast');
    callBtn.classList.add('on');
    callBtn.textContent = t('ivAnswerCall');
    toast(t('ivCallIncoming'));
  }
  function failCall(msg) {
    callTip.hidden = false; callTip.textContent = '⚠️ ' + msg;
    callBtn.textContent = t('ivCallBtn'); callBtn.classList.remove('on');
    callStarted = false;
    if (callConnTimer) { clearTimeout(callConnTimer); callConnTimer = null; }
    fbAutoExpand();            // 任何 fail 先把备选会议号卡展开（可见但不打断）
    fbEscalateAfter30s();      // 30 秒后自动滚动到该卡并高亮提醒填腾讯/飞书会议号
  }
  function stopCall() {
    callStarted = false;
    if (callConnTimer) { clearTimeout(callConnTimer); callConnTimer = null; }
    clearFbEscalation();
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (callStream) { callStream.getTracks().forEach(function (t) { t.stop(); }); callStream = null; }
    callBtn.textContent = t('ivCallBtn'); callBtn.classList.remove('on');
  }

  // ── 结束并评价 ──
  endBtn.addEventListener('click', function () {
    if (!confirm(t('ivConfirmEnd'))) return;
    finishInterview(true);
  });
  function finishInterview(doEval) {
    if (ended) return; ended = true;
    stopStt(); stopCall();
    if (unsubRemain) { try { unsubRemain(); } catch (_) {} unsubRemain = null; }
    stopPolling();
    if (doEval && window.FTSettings && window.FTSettings.hasLLM()) runEval();
    else if (doEval) { toast(t('ivNoLlm'), true); refreshSetupHint(); }
  }

  function runEval() {
    // 取最新完整转录
    ivGet().then(function (d) {
      var lines = (d && d.lines) || [];
      if (!lines.length) { toast(t('ivNoLines'), true); return; }
      var conv = lines.map(function (ln) { return (ln.mine ? t('msgMine') : t('msgPeer')) + '：' + ln.text; }).join('\n');
      var cfg = window.FTSettings.get();
      var sys = t('ivEvalSys');
      evalBox.hidden = false;
      evalBox.innerHTML = '<p class="iv-eval-loading">' + t('ivEvalLoading') + '</p>';
      evalBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      fetch('/api/llm?type=chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          base: cfg.llmBase, key: cfg.llmKey, model: cfg.llmModel,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: t('ivEvalConvPrefix') + conv },
          ],
        }),
      }).then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (r) {
          if (!r.ok) { evalBox.innerHTML = '<p class="iv-eval-err">' + t('ivEvalErr') + esc(r.error || r.status || t('ivUnknown')) + '</p>'; return; }
          renderEval(r.content || '');
        })
        .catch(function () { evalBox.innerHTML = '<p class="iv-eval-err">' + t('ivEvalReqErr') + '</p>'; });
    });
  }
  function renderEval(content) {
    var data = null;
    try { data = JSON.parse((content || '').replace(/^[\s\S]*?\{/, '{').replace(/\}[\s\S]*$/, '}')); } catch (e) {}
    if (!data) { evalBox.innerHTML = '<div class="iv-eval-raw"><h4>' + t('ivEvalRawTitle') + '</h4><pre>' + esc(content) + '</pre></div>'; return; }
    var html = '<h4>' + t('ivEvalTitle') + '</h4>';
    if (data.summary) html += '<p class="iv-summary">' + esc(data.summary) + '</p>';
    if (data.scores && data.scores.length) {
      html += '<div class="iv-scores">';
      data.scores.forEach(function (s) {
        var sc = Math.max(1, Math.min(5, parseInt(s.score, 10) || 3));
        html += '<div class="iv-score"><div class="iv-score-top"><span>' + esc(s.dim) + '</span><strong>' + sc + '/5</strong></div>'
          + '<div class="iv-bar"><i style="width:' + (sc * 20) + '%"></i></div>'
          + (s.reason ? '<p class="iv-reason">' + esc(s.reason) + '</p>' : '') + '</div>';
      });
      html += '</div>';
    }
    if (data.advice && data.advice.length) {
      html += '<h5>' + t('ivEvalAdvice') + '</h5><ul class="iv-advice">';
      data.advice.slice(0, 5).forEach(function (a) { html += '<li>' + esc(a) + '</li>'; });
      html += '</ul>';
    }
    html += '<button class="btn-mini grey" id="iv-eval-again">' + t('ivEvalAgain') + '</button>';
    evalBox.innerHTML = html;
    var again = $('iv-eval-again'); if (again) again.addEventListener('click', runEval);
  }

  // ── 设置提示 ──
  function refreshSetupHint() {
    if (!window.FTSettings) return;
    var need = [];
    if (!window.FTSettings.hasLLM()) need.push(t('ivNeedLlm'));
    if (!window.FTSettings.hasSTT()) need.push(t('ivNeedStt'));
    if (need.length) {
      needset.hidden = false;
      needset.innerHTML = t('ivNeedSet') + need.join(' / ') + '。';
    } else { needset.hidden = true; needset.innerHTML = ''; }
  }
  window.FT.onSettingsChange = refreshSetupHint;

  // 供 pair.html 的试音门禁调用：互评通过、面试间刚露出来时刷新一次提示
  window.FTInterview = {
    // 解锁面试间时顺手预热中继凭证 + 订阅搭子房间倒计时 + 启动转录轮询
    // v2.3 取消「点开始面试」门槛 —— 解锁即 ready，录音转文字/实时语音/AI 评价全部即时可用
    onUnlock: function () {
      refreshSetupHint();
      try { withIce(function () {}); } catch (e) {}
      fbEnsureShown(); renderFallbackStatus();
      startSharedTimer();   // 订阅搭子房间 10 分钟倒计时，归零自动 AI 评价
      active = true; evalRequested = false; ended = false;
      startPolling();       // 立即拉转录/信令 —— 进房即就绪，不点「开始」也能收到对方的对话行与语音 offer
      try { console.log('[FaceTalk/iv] polling started, me=' + me + ', pair=' + pairId); } catch (e) {}
      // 立即拉一次（不等 1.5s 周期），并把"我方前 5 条对话历史"也打印出来，便于用户对照 Network
      ivGet().then(function (d) {
        try {
          console.log('[FaceTalk/iv] first poll ok=' + (d && d.ok) + ', lines=' + ((d && d.lines) || []).length
            + ', signals=' + ((d && d.signals) || []).length
            + ', fallbackTen=' + (d && d.fallback && d.fallback.tencent));
          if (d && d.lines) d.lines.forEach(function (ln) {
            console.log('  line ' + ln.id + ' who=' + ln.who + ' mine=' + ln.mine + ' text=' + JSON.stringify(ln.text));
          });
        } catch (e) {}
      }).catch(function (e) { try { console.warn('[FaceTalk/iv] first poll failed', e); } catch (_) {} });
    },
    // 房间解散 / 页面离开时兜底收拾麦克风与连接，避免录音灯常亮
    teardown: function () {
      if (callConnTimer) { clearTimeout(callConnTimer); callConnTimer = null; }
      if (unsubRemain) { try { unsubRemain(); } catch (_) {} unsubRemain = null; }
      stopStt(); stopCall(); stopPolling();
    },
    isRunning: function () { return active && !ended; },
  };
  window.addEventListener('beforeunload', function () { try { window.FTInterview.teardown(); } catch (e) {} });
})();
