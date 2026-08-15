// ============================================================
// FaceTalk v2.2 设置：语音转写引擎 + AI 点评（自备 Key，仅本机）
// 对齐辅警站 ai-settings-modal 视觉/交互；本地存储 key = rcj_ft_asr_v1
// 暴露接口与 v2.1 完全兼容：window.FTSettings.{ get, hasLLM, hasSTT,
//   sttOn, sttMode, browserSttSupported, browserSttLang, open, close }
//   其中 get() 仍返回 { provider, llmBase, llmKey, llmModel,
//   sttBase, sttKey, sttModel, sttOn, sttMode }（供 interview.js /api/llm 用）
// ============================================================
(function () {
  var STORAGE_KEY = 'rcj_ft_asr_v1';
  var OLD_KEY_V21 = 'ft_settings_v21';
  var PRESETS = {
    silicon: { name: '硅基流动（推荐 / 国内直连）', llmBase: 'https://api.siliconflow.cn/v1', llmModel: 'Qwen/Qwen2.5-7B-Instruct', sttBase: 'https://api.siliconflow.cn/v1', sttModel: 'FunAudioLLM/SenseVoiceSmall' },
    deepseek: { name: 'DeepSeek', llmBase: 'https://api.deepseek.com/v1', llmModel: 'deepseek-chat', sttBase: '', sttModel: '' },
    qwen:     { name: '通义千问（DashScope 兼容）', llmBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', llmModel: 'qwen-plus', sttBase: '', sttModel: '' },
    moonshot: { name: 'Kimi (Moonshot)', llmBase: 'https://api.moonshot.cn/v1', llmModel: 'moonshot-v1-8k', sttBase: '', sttModel: '' },
    openai:   { name: 'OpenAI', llmBase: 'https://api.openai.com/v1', llmModel: 'gpt-4o-mini', sttBase: 'https://api.openai.com/v1', sttModel: 'whisper-1' },
    custom:   { name: '自定义（填下面的地址）', llmBase: '', llmModel: '', sttBase: '', sttModel: '' },
  };

  function defaultS() {
    return {
      asrEngine: 'webspeech',                          // 'webspeech' | 'cloud'
      asr: { baseUrl: '', key: '', model: '' },
      llm: { enabled: false, baseUrl: '', key: '', model: '' },
      preset: 'silicon',
    };
  }

  function load() {
    var s = defaultS();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p.asr) s.asr = Object.assign(s.asr, p.asr);
        if (p.llm) s.llm = Object.assign(s.llm, p.llm);
        if (p.asrEngine === 'cloud' || p.asrEngine === 'webspeech') s.asrEngine = p.asrEngine;
        if (p.preset && PRESETS[p.preset]) s.preset = p.preset;
      } else {
        // 从 v2.1 老 schema 升级
        var old = JSON.parse(localStorage.getItem(OLD_KEY_V21) || '{}');
        if (old.llmBase || old.llmKey || old.llmModel) {
          s.llm = { enabled: true, baseUrl: old.llmBase || '', key: old.llmKey || '', model: old.llmModel || '' };
          s.llm.enabled = !!(old.llmBase && old.llmKey && old.llmModel);
          s.preset = 'custom';
        }
        if (old.sttMode === 'browser' || old.sttMode === 'api') {
          s.asrEngine = (old.sttMode === 'browser') ? 'webspeech' : 'cloud';
          if (s.asrEngine === 'cloud') {
            s.asr = { baseUrl: old.sttBase || old.llmBase || '', key: old.sttKey || old.llmKey || '', model: old.sttModel || '' };
          }
          if (!old.llmBase && !old.llmKey && !old.llmModel && s.asrEngine === 'cloud') {
            // 老用户只配了 STT，保留 STT 三件套，AI 不启用
            s.asr.baseUrl = old.sttBase || '';
          }
        }
      }
    } catch (e) {}
    return s;
  }
  function save(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {} }

  // 当前内存中的设置（每次保存更新）
  var S = load();

  // 把内部 schema 映射为老 schema（interview.js 沿用的字段）
  function toLegacySchema(s) {
    var sttBase, sttKey, sttModel, sttMode, sttOn;
    if (s.asrEngine === 'webspeech') {
      sttBase = ''; sttKey = ''; sttModel = ''; sttMode = 'browser'; sttOn = true;
    } else { // cloud
      sttBase = s.asr.baseUrl || ''; sttKey = s.asr.key || ''; sttModel = s.asr.model || '';
      sttMode = 'api'; sttOn = true;
    }
    return {
      provider: s.preset || 'custom',
      preset: s.preset,
      asrEngine: s.asrEngine,
      llmBase: s.llm.baseUrl || '',
      llmKey: s.llm.key || '',
      llmModel: s.llm.model || '',
      sttBase: sttBase, sttKey: sttKey, sttModel: sttModel,
      sttMode: sttMode, sttOn: sttOn,
      llmEnabled: !!s.llm.enabled,
    };
  }

  function get() { return toLegacySchema(S); }

  function hasLLM() { return !!(S.llm.enabled && S.llm.baseUrl && S.llm.key && S.llm.model); }
  // v2.4 顶栏「接口」按钮角标：没配任何东西（LLM 没启用 + ASR 也不是浏览器内置/没配云端）→ 返回 true
  // 配合 pair.html 顶栏 badge 显示「未配置」红字提示
  function unconfigured() {
    if (hasLLM()) return false;
    // ASR 至少要支持其一：浏览器内置 STT 可用，或云端 STT 配齐了
    if (S.asrEngine === 'webspeech' && typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)) return false;
    if (S.asrEngine === 'cloud' && S.asr.baseUrl && S.asr.key && S.asr.model) return false;
    return true;
  }
  function hasSTT() {
    if (S.asrEngine === 'webspeech') return !!getBrowserSttCtor();
    return !!(S.asr.baseUrl && S.asr.key && S.asr.model);
  }
  function sttOn() { return S.asrEngine === 'webspeech' || S.asrEngine === 'cloud'; }
  function sttMode() { return S.asrEngine === 'webspeech' ? 'browser' : 'api'; }

  function getBrowserSttCtor() {
    try { return window.SpeechRecognition || window.webkitSpeechRecognition || null; } catch (e) { return null; }
  }
  function browserSttSupported() { return !!getBrowserSttCtor(); }
  function browserSttLang() {
    try {
      var nav = (navigator.language || 'zh-CN').toLowerCase();
      return nav.startsWith('zh') ? 'zh-CN' : 'en-US';
    } catch (e) { return 'zh-CN'; }
  }

  // ── 弹窗 DOM ──
  var built = false;
  function build() {
    if (built) return; built = true;
    var wrap = document.createElement('div');
    wrap.className = 'set-mask';
    wrap.id = 'set-mask';
    wrap.innerHTML =
      '<div class="set-modal">' +
        '<div class="set-head"><span>⚙ 设置</span><button class="set-x" id="set-x">✕</button></div>' +
        '<div class="set-tabs"><button class="set-tab active" data-tab="config">⚙ 接口设置</button><button class="set-tab" data-tab="about">ℹ 关于</button></div>' +
        '<div class="set-panel set-panel-active" id="set-panel-config">' +
          '<p class="set-tip">语音转写和 AI 点评需你自己的 API Key，<b>Key 仅保存在本机浏览器</b>，不会上传给任何人。</p>' +
          '<div class="set-section-title">🎙 语音转写引擎</div>' +
          '<div class="set-engine-opt">' +
            '<label class="set-engine-row"><input type="radio" name="aiAsrEngine" value="webspeech" /> <span><b>🌐 浏览器内置</b>（免费，部分手机/微信不支持）</span></label>' +
            '<label class="set-engine-row"><input type="radio" name="aiAsrEngine" value="cloud" /> <span><b>☁️ 云端 API</b>（国内直连·推荐）</span></label>' +
          '</div>' +
          '<p class="set-sub-hint">浏览器内置无需 Key，但 iOS Safari / 微信内置常无法转写；云端 API 需配置 Key，几乎全平台可用。</p>' +
          '<div id="set-asr-cloud" hidden>' +
            '<label class="set-field">API Base URL（Whisper 兼容）<input class="set-input" id="set-asrBase" placeholder="https://api.siliconflow.cn/v1" autocomplete="off" /></label>' +
            '<label class="set-field">API Key<input class="set-input" id="set-asrKey" type="password" placeholder="sk-...（仅存本机）" autocomplete="off" /></label>' +
            '<label class="set-field">模型名<input class="set-input" id="set-asrModel" placeholder="FunAudioLLM/SenseVoiceSmall" autocomplete="off" /></label>' +
            '<p class="set-sub-hint">推荐硅基流动 SenseVoice：<code>https://api.siliconflow.cn/v1</code> + <code>FunAudioLLM/SenseVoiceSmall</code></p>' +
          '</div>' +
          '<div class="set-section-title">🤖 AI 点评</div>' +
          '<label class="set-chk"><input type="checkbox" id="set-llmEnabled" /> <span>✅ 启用 AI 点评</span></label>' +
          '<div id="set-llm-body">' +
            '<label class="set-field">预设<select class="set-input" id="set-preset">' + Object.keys(PRESETS).map(function (k) { return '<option value="' + k + '">' + PRESETS[k].name + '</option>'; }).join('') + '</select></label>' +
            '<label class="set-field">API Base URL<input class="set-input" id="set-llmBase" placeholder="https://api.siliconflow.cn/v1" autocomplete="off" /></label>' +
            '<label class="set-field">API Key（sk- 开头）<input class="set-input" id="set-llmKey" type="password" placeholder="sk-...（仅存本机）" autocomplete="off" /></label>' +
            '<label class="set-field">模型名<input class="set-input" id="set-llmModel" placeholder="Qwen/Qwen2.5-7B-Instruct 或 deepseek-chat" autocomplete="off" /></label>' +
          '</div>' +
          '<div class="set-actions">' +
            '<button class="btn-mini" id="set-test" type="button">🧪 测试连接</button>' +
            '<span class="set-test-result" id="set-test-result"></span>' +
          '</div>' +
          '<div class="set-actions set-actions-bottom">' +
            '<button class="btn-mini grey" id="set-clear" type="button">清除全部</button>' +
            '<button class="btn-mini grey" id="set-close" type="button">关闭</button>' +
            '<button class="btn-primary" id="set-save" type="button">保存</button>' +
          '</div>' +
          '<p class="set-hint">📘 <a href="https://exam.955827.xyz/tutorials/api-key.html" target="_blank" rel="noopener">国内大模型免费 API 获取教程</a></p>' +
        '</div>' +
        '<div class="set-panel" id="set-panel-about">' +
          '<div class="set-about">' +
            '<p class="set-about-lead">FaceTalk 不是找人聊天的平台，而是<b>面试群里的智能连接工具</b>。没有量的时候先做工具、借已有的考试群冷启动；等群里每天都有人通过它流转，再自然长成生态。</p>' +
            '<div class="set-journey">' +
              '<span><b>认识</b> 考试群里已有一群想练的人</span>' +
              '<span><b>试音</b> 60 秒录音互相听声</span>' +
              '<span><b>匹配</b> 双方都愿意才组队</span>' +
              '<span><b>成长</b> 互评互练，一起进步</span>' +
            '</div>' +
            '<ul class="set-about-list">' +
              '<li>📉 <b>更低获客成本</b>：群里已在问"有人一起练吗"，你只要说"别私聊了，丢个 FaceTalk 60 秒试音"。</li>' +
              '<li>🛡️ <b>更低信任成本</b>：同群都是冲同一个考试来的，天然同目标、同节点。</li>' +
              '<li>⚡ <b>更低匹配成本</b>：文字尬聊半小时才发现一个考消防一个考教师；60 秒试音直接筛人。</li>' +
            '</ul>' +
            '<p class="set-about-safe">🔒 双方提交才能互听 · 🕓 录音阅后即焚 · 🚫 严禁留微信 / 手机号，防骗是底线。</p>' +
            '<p class="set-about-safe">从「不敢说」到「会表达」，一条线：<b>SoloSpeak</b>（录音练习）→ <b>FaceTalk</b>（真人筛选）→ <b>RCJ Exam Hub</b>（真题刷题 + AI 点评）。</p>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.getElementById('set-x').addEventListener('click', close);
    document.getElementById('set-close').addEventListener('click', close);

    // Tab 切换：接口设置 / 关于
    var tabs = wrap.querySelectorAll('.set-tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        var target = this.getAttribute('data-tab');
        tabs.forEach(function (x) { x.classList.remove('active'); });
        this.classList.add('active');
        wrap.querySelectorAll('.set-panel').forEach(function (p) { p.classList.remove('set-panel-active'); });
        var panel = document.getElementById('set-panel-' + target);
        if (panel) panel.classList.add('set-panel-active');
      });
    });

    // 切预设：自动填 baseUrl/model（仅在用户没改过的情况下覆盖）
    document.getElementById('set-preset').addEventListener('change', function () {
      var k = this.value;
      var p = PRESETS[k]; if (!p) return;
      document.getElementById('set-llmBase').value = p.llmBase;
      document.getElementById('set-llmModel').value = p.llmModel;
      // 顺手把 asr 也预填（如果不是云端，先不开面板）
      if (S.asrEngine === 'cloud') {
        document.getElementById('set-asrBase').value = p.sttBase;
        document.getElementById('set-asrModel').value = p.sttModel;
      }
    });

    // 切引擎：显隐云端面板
    function syncAsrPanel() {
      var eng = (document.querySelector('input[name="aiAsrEngine"]:checked') || { value: 'webspeech' }).value;
      var p = document.getElementById('set-asr-cloud');
      if (p) p.hidden = (eng !== 'cloud');
    }
    var radios = document.querySelectorAll('input[name="aiAsrEngine"]');
    radios.forEach(function (r) { r.addEventListener('change', syncAsrPanel); });

    // 启用 AI 点评 → 显隐下方表单
    document.getElementById('set-llmEnabled').addEventListener('change', function () {
      document.getElementById('set-llm-body').hidden = !this.checked;
    });

    // 保存
    document.getElementById('set-save').addEventListener('click', function () {
      var eng = (document.querySelector('input[name="aiAsrEngine"]:checked') || { value: 'webspeech' }).value;
      S = {
        asrEngine: eng,
        asr: {
          baseUrl: document.getElementById('set-asrBase').value.trim(),
          key: document.getElementById('set-asrKey').value.trim(),
          model: document.getElementById('set-asrModel').value.trim(),
        },
        llm: {
          enabled: document.getElementById('set-llmEnabled').checked,
          baseUrl: document.getElementById('set-llmBase').value.trim(),
          key: document.getElementById('set-llmKey').value.trim(),
          model: document.getElementById('set-llmModel').value.trim(),
        },
        preset: document.getElementById('set-preset').value,
      };
      // 简单校验
      if (S.asrEngine === 'cloud') {
        if (!S.asr.baseUrl) { toast('已选择「云端 API」转写，必须填写 API Base URL', true); return; }
        if (!S.asr.key) { toast('已选择「云端 API」转写，必须填写 API Key', true); return; }
        if (!S.asr.model) { toast('已选择「云端 API」转写，必须填写模型名', true); return; }
      }
      if (S.llm.enabled) {
        if (!S.llm.baseUrl) { toast('已启用 AI 点评，但缺少 API Base URL', true); return; }
        if (!S.llm.key) { toast('已启用 AI 点评，但缺少 API Key', true); return; }
        if (!S.llm.model) { toast('已启用 AI 点评，但缺少模型名', true); return; }
      }
      save(S);
      var r = document.getElementById('set-test-result');
      r.style.color = '#2e7d32'; r.textContent = '✅ 已保存（仅本机）';
      setTimeout(function () { r.textContent = ''; }, 1800);
      if (window.FT && window.FT.onSettingsChange) window.FT.onSettingsChange();
    });

    // 清除全部
    document.getElementById('set-clear').addEventListener('click', function () {
      if (!confirm('清除本机保存的全部接口设置？')) return;
      S = defaultS();
      save(S); fill();
      if (window.FT && window.FT.onSettingsChange) window.FT.onSettingsChange();
    });

    // 测试连接（两步探测 /models + /chat/completions）
    document.getElementById('set-test').addEventListener('click', async function () {
      var btn = this, r = document.getElementById('set-test-result');
      var baseUrl = document.getElementById('set-llmBase').value.trim();
      var key = document.getElementById('set-llmKey').value.trim();
      var model = document.getElementById('set-llmModel').value.trim();
      if (!baseUrl) { r.style.color = '#dc2626'; r.textContent = '❌ 请先填 API Base URL'; return; }
      if (!key) { r.style.color = '#dc2626'; r.textContent = '❌ 请先填 API Key'; return; }
      if (!model) { r.style.color = '#dc2626'; r.textContent = '❌ 请先填模型名'; return; }
      btn.disabled = true; r.style.color = '#6b7280'; r.textContent = '⏳ 第一步：探测 /models ...';
      var orig = baseUrl;
      if (!/^https?:\/\//i.test(baseUrl)) baseUrl = 'https://' + baseUrl;
      baseUrl = baseUrl.replace(/\/+$/, '');
      function fail(msg, c) { c = c || '#dc2626'; btn.disabled = false; r.style.color = c; r.textContent = msg; }
      try {
        var res1 = await fetch(baseUrl + '/models', { method: 'GET', mode: 'cors', headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + key } });
        if (!res1.ok) throw new Error('HTTP ' + res1.status + '（第一步 /models 失败）');
        r.textContent = '⏳ 第二步：验证 Key+模型 /chat/completions ...';
        var res2 = await fetch(baseUrl + '/chat/completions', {
          method: 'POST', mode: 'cors',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({ model: model, messages: [{ role: 'user', content: '你好' }], max_tokens: 5, stream: false })
        });
        if (!res2.ok) throw new Error('HTTP ' + res2.status + '（第二步失败）');
        var j = await res2.json().catch(function () { return {}; });
        var ans = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
        fail(ans ? ('✅ 连接成功！模型回复：' + ans.slice(0, 30)) : '⚠️ 连接成功但返回为空（模型名可能不对）', ans ? '#059669' : '#b45309');
      } catch (e) {
        var msg = String(e.message || e || '');
        if (/Failed to fetch|NetworkError|Network request failed|Failed to load/i.test(msg)) msg = '网络失败：请检查 URL 是否以 https:// 开头、本机能否访问外网';
        else if (/timeout/i.test(msg)) msg = '请求超时：请检查 URL 与本机外网连接';
        fail('❌ ' + msg);
      }
    });
  }

  function fill() {
    var radios = document.querySelectorAll('input[name="aiAsrEngine"]');
    radios.forEach(function (r) { r.checked = (r.value === S.asrEngine); });
    var eng = S.asrEngine || 'webspeech';
    document.getElementById('set-asr-cloud').hidden = (eng !== 'cloud');
    document.getElementById('set-asrBase').value = S.asr.baseUrl || '';
    document.getElementById('set-asrKey').value = S.asr.key || '';
    document.getElementById('set-asrModel').value = S.asr.model || '';
    document.getElementById('set-llmEnabled').checked = !!S.llm.enabled;
    document.getElementById('set-llm-body').hidden = !S.llm.enabled;
    document.getElementById('set-preset').value = S.preset || 'custom';
    document.getElementById('set-llmBase').value = S.llm.baseUrl || '';
    document.getElementById('set-llmKey').value = S.llm.key || '';
    document.getElementById('set-llmModel').value = S.llm.model || '';
    document.getElementById('set-test-result').textContent = '';
  }

  function toast(m, err) {
    if (window.FT && window.FT.toast) return window.FT.toast(m, err);
    try { alert(m); } catch (e) {}
  }

  function open(opts) {
    build();
    // 每次打开时读最新（用户在另一个 tab 改了也能生效）
    opts = opts || {};
    var m = document.getElementById('set-mask');
    var tabBar = m.querySelector('.set-tabs');
    var headSpan = m.querySelector('.set-head > span');
    var configTab = m.querySelector('.set-tab[data-tab="config"]');
    var aboutTab = m.querySelector('.set-tab[data-tab="about"]');
    var configPanel = document.getElementById('set-panel-config');
    var aboutPanel = document.getElementById('set-panel-about');
    if (opts.hideAbout) {
      // 练习页（一个人练）只需配置接口，不重复展示产品理念
      if (tabBar) tabBar.style.display = 'none';
      if (headSpan) headSpan.textContent = '⚙ 接口设置';
      if (configTab) configTab.classList.add('active');
      if (aboutTab) aboutTab.classList.remove('active');
      if (configPanel) configPanel.classList.add('set-panel-active');
      if (aboutPanel) aboutPanel.classList.remove('set-panel-active');
    } else {
      // 落地页：接口设置 + 关于 两个 Tab 都给（默认停在接口设置）
      if (tabBar) tabBar.style.display = '';
      if (headSpan) headSpan.textContent = '⚙ 设置';
      if (configTab) configTab.classList.add('active');
      if (aboutTab) aboutTab.classList.remove('active');
      if (configPanel) configPanel.classList.add('set-panel-active');
      if (aboutPanel) aboutPanel.classList.remove('set-panel-active');
    }
    S = load();
    fill();
    m.style.display = 'flex';
  }
  function close() { var m = document.getElementById('set-mask'); if (m) m.style.display = 'none'; }

  window.FTSettings = {
    get: get, hasLLM: hasLLM, hasSTT: hasSTT, sttOn: sttOn, sttMode: sttMode, unconfigured: unconfigured,
    browserSttSupported: browserSttSupported, browserSttLang: browserSttLang,
    open: open, close: close,
  };
})();
