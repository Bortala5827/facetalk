// ============================================================
// FaceTalk v2.1 面试间逻辑
// 依赖 window.FT（me / pairId / toast / esc）与 window.FTSettings
//   - 计时（30/45/60 分钟）
//   - 实时转录：我方用 MediaRecorder 分段 → 用户自带的 Whisper 接口转文字 → 写入面试间，双方同步
//   - 原生 WebRTC 语音（信令走 /api/interview，无 TURN 时回落腾讯会议）
//   - 结束 → 用用户自带大模型对完整对话稿做结构化评价
// ============================================================
(function () {
  if (!window.FT || !window.FT.me || !window.FT.pairId) return;
  var me = window.FT.me, pairId = window.FT.pairId;
  var esc = window.FT.esc, toast = window.FT.toast;

  var $ = function (id) { return document.getElementById(id); };

  // 元素
  var setup = $('iv-setup'), live = $('iv-live'), timerEl = $('iv-timer'),
      startBtn = $('iv-start'), durSel = $('iv-dur'), needset = $('iv-needset'),
      endBtn = $('iv-end'), sttBtn = $('iv-stt'), callBtn = $('iv-call'),
      transcript = $('iv-transcript'), noteInput = $('iv-note'), noteSend = $('iv-note-send'),
      evalBox = $('iv-eval'), callTip = $('iv-call-tip');
  // 备选会议号元素
  var fbCard = $('iv-fallback'), fbToggle = $('iv-fb-toggle'), fbBody = $('iv-fb-body'),
      fbStatus = $('iv-fb-status'), fbChev = $('iv-fb-chev'),
      fbTen = $('iv-fb-tencent'), fbFei = $('iv-fb-feishu'), fbSave = $('iv-fb-save'),
      fbToast = $('iv-fb-toast'), fbPeer = $('iv-fb-peer'),
      fbPeerTen = $('iv-fb-peer-tencent'), fbPeerFei = $('iv-fb-peer-feishu');

  // 状态
  var running = false, remainSec = 0, tickTimer = null, pollTimer = null;
  var known = {};                 // 已渲染的转录行 id
  var lastSignal = 0;             // 信令轮询游标（秒级，回退 2 秒重叠取，靠 seenSig 去重）
  var seenSig = {};               // 已处理过的信令 id，防重叠区间重复处理
  var pendingOffer = null;        // 对方发起语音但本方还没接听时暂存
  var sttOn = false, sttStream = null, sttRec = null, sttErrShown = false;
  // 浏览器原生 STT（Web Speech API）状态
  var sttBrowser = null, sttBrowserOn = false, sttBrowserLast = '', sttBrowserLastEmit = 0;
  var pc = null, callStream = null, callStarted = false, callConnTimer = null;
  var ended = false;
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

  // ── 开始面试 ──
  startBtn.addEventListener('click', function () {
    var dur = parseInt(durSel.value, 10) || 45;
    remainSec = dur * 60;
    running = true; ended = false;
    setup.hidden = true; live.hidden = false;
    evalBox.hidden = true; evalBox.innerHTML = '';
    renderTimer();
    tickTimer = setInterval(renderTick, 1000);
    startPolling();
    // 若已配置 STT，自动开启录音转文字（最省事）
    if (window.FTSettings && window.FTSettings.hasSTT()) {
      setTimeout(function () { if (!sttOn) toggleStt(); }, 400);
    } else {
      toast('未配置语音转文字，可手动记笔记；结束后仍可 AI 评价');
    }
    toast('面试开始，计时 ' + dur + ' 分钟');
  });

  // ── 计时 ──
  function renderTimer() {
    var m = Math.floor(remainSec / 60), s = remainSec % 60;
    timerEl.textContent = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }
  function renderTick() {
    if (remainSec <= 0) {
      renderTimer();
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
      onTimeUp();
      return;
    }
    remainSec--; renderTimer();
  }
  function onTimeUp() {
    toast('⏰ 时间到');
    stopStt();
    if (window.FTSettings && window.FTSettings.hasLLM()) runEval();
    else { toast('已自动停止录音；点「结束并 AI 评价」可在配置模型后生成点评'); }
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
  function poll() {
    ivGet().then(function (d) {
      if (!d || !d.ok) return;
      // 转录行
      (d.lines || []).forEach(function (ln) {
        if (known[ln.id]) return;
        known[ln.id] = 1;
        appendLine(ln.mine ? '我' : '对方', ln.text);
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
    }).catch(function () {});
  }
  function appendLine(who, text) {
    if (!text) return;
    var empty = transcript.querySelector('p.muted'); if (empty) empty.remove();
    var div = document.createElement('div');
    div.className = 'iv-line ' + (who === '我' ? 'iv-mine' : 'iv-peer');
    div.innerHTML = '<span class="iv-who">' + esc(who) + '</span><span class="iv-txt">' + esc(text) + '</span>';
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
    if (!mineHas && !peerHas) { fbStatus.textContent = '未填'; fbStatus.className = 'iv-fb-status none'; }
    else if (mineHas && !peerHas) { fbStatus.textContent = '你已填 · 等对方'; fbStatus.className = 'iv-fb-status wait'; }
    else if (!mineHas && peerHas) { fbStatus.textContent = '对方已填 · 你未填'; fbStatus.className = 'iv-fb-status wait'; }
    else { fbStatus.textContent = '双方都填好了 ✅'; fbStatus.className = 'iv-fb-status ok'; }
    fbChev.textContent = fbExpanded ? '▾' : '▸';
    fbToggle.setAttribute('aria-expanded', fbExpanded ? 'true' : 'false');
    fbBody.hidden = !fbExpanded;
    // 对方填的：放在卡里给双方看，不能编辑
    var showPeer = peerHas && fbExpanded;
    fbPeer.hidden = !showPeer;
    if (showPeer) {
      fbPeerTen.textContent = peerT ? ('📞 腾讯会议：' + peerT) : '📞 腾讯会议：（未填）';
      fbPeerFei.textContent = peerF ? ('📞 飞书会议：' + peerF) : '📞 飞书会议：（未填）';
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
        if (!t && !f) { fbToast.textContent = '至少填一项'; setTimeout(function () { fbToast.textContent = ''; }, 1500); return; }
        fbSave.disabled = true;
        fetch('/api/interview', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ me: me, pair: pairId, action: 'set-fallback', tencent: t, feishu: f }),
        }).then(function (r) { return r.json().catch(function () { return {}; }); })
          .then(function (d) {
            fbSave.disabled = false;
            if (d && d.ok) {
              fbToast.textContent = '已保存';
              setTimeout(function () { fbToast.textContent = ''; }, 1500);
              renderFallbackStatus();
            } else {
              fbToast.textContent = '保存失败：' + (d.error || '未知');
            }
          })
          .catch(function () { fbSave.disabled = false; fbToast.textContent = '保存失败'; });
      });
    }
  }

  // ── 手动补充 ──
  function sendNote() {
    var v = noteInput.value.replace(/\s+/g, ' ').trim();
    if (!v) return;
    noteInput.value = '';
    fetch('/api/interview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ me: me, pair: pairId, action: 'line', text: v }),
    }).then(function () { /* 轮询会带回，包括自己这条 */ }).catch(function () {});
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
      toast('请先点右上角 ⚙ 开启录音转文字', true);
      if (window.FTSettings) window.FTSettings.open();
      return;
    }
    var mode = (window.FTSettings && window.FTSettings.sttMode) || 'api';
    if (mode === 'browser') startSttBrowser();
    else startSttApi();
  }
  function startSttApi() {
    if (!window.FTSettings || !window.FTSettings.hasSTT()) {
      toast('请先点右上角 ⚙ 配置 Whisper 兼容接口', true);
      if (window.FTSettings) window.FTSettings.open();
      return;
    }
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      toast('当前浏览器不支持 MediaRecorder，请改用「浏览器自带」模式', true); return;
    }
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
      .then(function (s) {
        sttStream = s; sttErrShown = false;
        var mt = pickMime();
        try { sttRec = new MediaRecorder(s, mt ? { mimeType: mt, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 }); }
        catch (e) { try { sttRec = new MediaRecorder(s); } catch (e2) { toast('录音初始化失败', true); return; } }
        sttRec.ondataavailable = function (e) { if (e.data && e.data.size) sttSend(e.data); };
        sttRec.start(20000);   // 每 20 秒产出一段，增量转写
        sttOn = true; updateSttBtn();
        toast('🎙 已开启录音转文字（API）');
      })
      .catch(function () { toast('没拿到麦克风权限，请在浏览器允许', true); });
  }
  function startSttBrowser() {
    // 浏览器原生 STT：必须先拿麦克风（Chrome 强制要求），再启 SpeechRecognition
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('当前浏览器拿不到麦克风，无法启用浏览器自带转录', true); return;
    }
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast('当前浏览器不支持 SpeechRecognition，请改 Chrome / Edge 或用 API 模式', true); return;
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
        if (!sttErrShown) { sttErrShown = true; toast('浏览器语音识别出错：' + (e.error || '未知') + '（检查麦克风权限）', true); }
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
        toast('🎙 已开启浏览器自带转文字（Chrome / Edge）');
      } catch (e) { toast('浏览器语音识别启动失败', true); }
    }).catch(function () { toast('没拿到麦克风权限，请在浏览器允许', true); });
  }
  function stopStt() {
    if (sttRec) { try { if (sttRec.state !== 'inactive') sttRec.stop(); } catch (e) {} sttRec = null; }
    if (sttStream) { sttStream.getTracks().forEach(function (t) { t.stop(); }); sttStream = null; }
    if (sttBrowser) { sttBrowserOn = false; try { sttBrowser.onend = null; sttBrowser.stop(); } catch (e) {} sttBrowser = null; }
    sttOn = false; updateSttBtn();
  }
  function updateSttBtn() {
    var on = sttOn || sttBrowserOn;
    sttBtn.textContent = on ? '🎙 录音转文字：开' : '🎙 录音转文字：关';
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
          toast('转写失败：' + (d.error || d.status || '未知') + '（检查接口/配额）', true);
        }
      })
      .catch(function (e) { if (!sttErrShown) { sttErrShown = true; toast('转写请求出错', true); } });
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
        callBtn.textContent = '🔊 实时语音：已连通'; callTip.hidden = true;
        fbAutoCollapseIfAuto();   // 连通后如果之前是自动展开的，就自动收回（用户主动展开过的不会被收回）
      } else if (p.connectionState === 'failed' || p.connectionState === 'disconnected') {
        if (callConnTimer) { clearTimeout(callConnTimer); callConnTimer = null; }
        onFail(turnOn
          ? '语音断开了，多半是网络波动 —— 再点一次可重连'
          : (gotSrflx
            ? '直连没打通（双方网络限制较严）—— 一方切 4G/5G 重试多半能成；不想折腾就往下滑到「📡 备选会议号」交换腾讯会议号，转录和 AI 点评照常可用'
            : '当前网络拿不到公网地址（校园网 / 公司内网常见），直连打不通 —— 一方切 4G/5G 重试，或往下滑到「📡 备选会议号」交换腾讯会议号，转录和 AI 点评照常可用'));
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
      failCall('当前浏览器拿不到麦克风 —— 微信/QQ 内置浏览器常被限制，请用手机自带浏览器或 Chrome 打开本页');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) { callStream = s; cb(s); })
      .catch(function (err) {
        var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        failCall(denied
          ? '麦克风权限被拒绝 —— 请在浏览器地址栏左侧允许麦克风后重试'
          : '拿不到麦克风（微信内置浏览器常被限制），请换手机自带浏览器，或改用腾讯会议链接');
      });
  }
  function startCall() {
    callStarted = true; callBtn.textContent = '🔊 实时语音：连接中…'; callBtn.classList.add('on');
    callTip.hidden = true;
    // 30 秒未连通 → 兜底：自动展开「备选会议号」卡，让用户把腾讯/飞书会议号填上，转走外部通话。
    // 节流设计：5~8 秒才在 UI 上出现 log（callTip 一直可见，便于看进度），到 30s 强制展开 fallback。
    // 已经 connected 时由 onconnectionstatechange 清掉计时器。
    if (callConnTimer) { clearTimeout(callConnTimer); callConnTimer = null; }
    callConnTimer = setTimeout(function () {
      if (pc && pc.connectionState === 'connected') return;
      toast('⌛ 30 秒还没连上，建议填一下会议号、走腾讯会议或飞书会议继续练', true);
      fbAutoExpand();
    }, 30000);
    // 若对方已经发过 offer，本方直接走应答路径，不要再互发 offer（会 glare 冲突）
    if (pendingOffer) { var o = pendingOffer; pendingOffer = null; handleSignal(o); return; }
    withIce(function () {
      ensureLocalStream(function (s) {
        try { pc = newPC(failCall); } catch (e) { failCall('浏览器不支持 WebRTC'); return; }
        s.getTracks().forEach(function (t) { pc.addTrack(t, s); });
        pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).then(function () {
          postSignal('offer', JSON.stringify(pc.localDescription));
        }).catch(function () { failCall('生成 offer 失败'); });
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
          callStarted = true; callBtn.classList.add('on'); callBtn.textContent = '🔊 实时语音：连接中…';
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
    callTip.innerHTML = '📞 对方发起了实时语音 —— 点上面的「🔊 实时语音」接听';
    callBtn.classList.add('on');
    callBtn.textContent = '🔊 接听对方语音';
    toast('📞 对方发起了实时语音');
  }
  function failCall(msg) {
    callTip.hidden = false; callTip.textContent = '⚠️ ' + msg;
    callBtn.textContent = '🔊 实时语音'; callBtn.classList.remove('on');
    callStarted = false;
    if (callConnTimer) { clearTimeout(callConnTimer); callConnTimer = null; }
    fbAutoExpand();   // 任何 fail 都把 fallback 展开
  }
  function stopCall() {
    callStarted = false;
    if (callConnTimer) { clearTimeout(callConnTimer); callConnTimer = null; }
    if (pc) { try { pc.close(); } catch (e) {} pc = null; }
    if (callStream) { callStream.getTracks().forEach(function (t) { t.stop(); }); callStream = null; }
    callBtn.textContent = '🔊 实时语音'; callBtn.classList.remove('on');
  }

  // ── 结束并评价 ──
  endBtn.addEventListener('click', function () {
    if (!confirm('结束本场面试并生成 AI 评价？结束后会停止录音与计时。')) return;
    finishInterview(true);
  });
  function finishInterview(doEval) {
    if (ended) return; ended = true;
    stopStt(); stopCall();
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    stopPolling();
    if (doEval && window.FTSettings && window.FTSettings.hasLLM()) runEval();
    else if (doEval) { toast('未配置大模型，无法生成评价；点 ⚙ 设置后可重跑', true); refreshSetupHint(); }
  }

  function runEval() {
    // 取最新完整转录
    ivGet().then(function (d) {
      var lines = (d && d.lines) || [];
      if (!lines.length) { toast('还没有对话稿，无法评价', true); return; }
      var conv = lines.map(function (ln) { return (ln.mine ? '我' : '对方') + '：' + ln.text; }).join('\n');
      var cfg = window.FTSettings.get();
      var sys = '你是辅警/消防/公务员/社区等招录结构化面试的资深考官。请根据下面的双人面试对话稿，从「我」（答题方）的角度给结构化点评。'
        + '严格用 JSON 输出：{"summary":"一句话总评","scores":[{"dim":"内容切题","score":1-5,"reason":"..."},'
        + '{"dim":"逻辑结构","score":1-5,"reason":"..."},{"dim":"语言表达","score":1-5,"reason":"..."},'
        + '{"dim":"岗位匹配度","score":1-5,"reason":"..."},{"dim":"综合表现","score":1-5,"reason":"..."}],'
        + '"advice":["给「我」的3条最该改进的实操建议"]}。不要输出 JSON 以外的解释文字。';
      evalBox.hidden = false;
      evalBox.innerHTML = '<p class="iv-eval-loading">🤖 大模型评价生成中…</p>';
      evalBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      fetch('/api/llm?type=chat', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          base: cfg.llmBase, key: cfg.llmKey, model: cfg.llmModel,
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: '面试对话稿：\n' + conv },
          ],
        }),
      }).then(function (r) { return r.json().catch(function () { return {}; }); })
        .then(function (r) {
          if (!r.ok) { evalBox.innerHTML = '<p class="iv-eval-err">评价失败：' + esc(r.error || r.status || '未知') + '</p>'; return; }
          renderEval(r.content || '');
        })
        .catch(function () { evalBox.innerHTML = '<p class="iv-eval-err">评价请求出错</p>'; });
    });
  }
  function renderEval(content) {
    var data = null;
    try { data = JSON.parse((content || '').replace(/^[\s\S]*?\{/, '{').replace(/\}[\s\S]*$/, '}')); } catch (e) {}
    if (!data) { evalBox.innerHTML = '<div class="iv-eval-raw"><h4>🤖 AI 评价</h4><pre>' + esc(content) + '</pre></div>'; return; }
    var html = '<h4>🤖 AI 面试评价</h4>';
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
      html += '<h5>💡 给你的改进建议</h5><ul class="iv-advice">';
      data.advice.slice(0, 5).forEach(function (a) { html += '<li>' + esc(a) + '</li>'; });
      html += '</ul>';
    }
    html += '<button class="btn-mini grey" id="iv-eval-again">重新评价</button>';
    evalBox.innerHTML = html;
    var again = $('iv-eval-again'); if (again) again.addEventListener('click', runEval);
  }

  // ── 设置提示 ──
  function refreshSetupHint() {
    if (!window.FTSettings) return;
    var need = [];
    if (!window.FTSettings.hasLLM()) need.push('大模型');
    if (!window.FTSettings.hasSTT()) need.push('语音转文字');
    if (need.length) {
      needset.hidden = false;
      needset.innerHTML = '⚙ 尚未配置：' + need.join(' / ') + '。点右上角 ⚙ 填写你自己的接口（仅存本机）。';
    } else { needset.hidden = true; needset.innerHTML = ''; }
  }
  window.FT.onSettingsChange = refreshSetupHint;

  // 供 pair.html 的试音门禁调用：互评通过、面试间刚露出来时刷新一次提示
  window.FTInterview = {
    // 解锁面试间时顺手预热中继凭证，等用户真点「实时语音」时已经在手，省掉一次等待
    onUnlock: function () { refreshSetupHint(); try { withIce(function () {}); } catch (e) {} fbEnsureShown(); renderFallbackStatus(); },
    // 房间解散 / 页面离开时兜底收拾麦克风与连接，避免录音灯常亮
    teardown: function () {
      if (callConnTimer) { clearTimeout(callConnTimer); callConnTimer = null; }
      stopStt(); stopCall(); stopPolling(); if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    },
    isRunning: function () { return running && !ended; },
  };
  window.addEventListener('beforeunload', function () { try { window.FTInterview.teardown(); } catch (e) {} });
})();
