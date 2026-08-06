// ============================================================
// FaceTalk v2.1 设置：用户自添加大模型接口（仅存本地，不上传服务器）
// 暴露 window.FTSettings.{ get, hasLLM, hasSTT, sttOn, open }
// ============================================================
(function () {
  var KEY = 'ft_settings_v21';
  var PRESETS = {
    openai:    { name: 'OpenAI',          llmBase: 'https://api.openai.com/v1',        llmModel: 'gpt-4o-mini',     sttBase: 'https://api.openai.com/v1',     sttModel: 'whisper-1' },
    deepseek:  { name: 'DeepSeek',        llmBase: 'https://api.deepseek.com/v1',      llmModel: 'deepseek-chat',   sttBase: '',                              sttModel: '' },
    qwen:      { name: '通义千问',         llmBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1', llmModel: 'qwen-plus', sttBase: '', sttModel: '' },
    moonshot:  { name: 'Kimi (Moonshot)', llmBase: 'https://api.moonshot.cn/v1',       llmModel: 'moonshot-v1-8k',  sttBase: '',                              sttModel: '' },
    silicon:   { name: 'SiliconFlow',     llmBase: 'https://api.siliconflow.cn/v1',    llmModel: 'Qwen/Qwen2.5-7B-Instruct', sttBase: 'https://api.siliconflow.cn/v1', sttModel: 'FunAudioLLM/SenseVoiceSmall' },
    custom:    { name: '自定义（填下面的地址）', llmBase: '', llmModel: '', sttBase: '', sttModel: '' },
  };

  function load() {
    try { return Object.assign({ provider: 'openai', llmBase: '', llmKey: '', llmModel: '', sttBase: '', sttKey: '', sttModel: '', sttOn: true, sttMode: 'api' }, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return { provider: 'openai', llmBase: '', llmKey: '', llmModel: '', sttBase: '', sttKey: '', sttModel: '', sttOn: true, sttMode: 'api' }; }
  }
  function save(s) { localStorage.setItem(KEY, JSON.stringify(s)); }

  var S = load();

  // 兼容历史：老用户只存了 sttOn，没有 sttMode，补一个默认值
  if (!S.sttMode) S.sttMode = S.sttOn ? 'api' : 'off';

  function get() { return S; }
  function hasLLM() { return !!(S.llmBase && S.llmKey && S.llmModel); }
  // STT 模式判断：浏览器原生路径不需要任何 key/api，浏览器认得出来就行
  function hasSTT() {
    if (S.sttMode === 'off') return false;
    if (S.sttMode === 'browser') return !!getBrowserSttCtor();
    // 'api'：未填 sttBase/Key 时回退用大模型的 Base/Key，只有模型名必须单独填（whisper-1 等）
    var b = S.sttBase || S.llmBase, k = S.sttKey || S.llmKey;
    return !!(b && k && S.sttModel);
  }
  function sttOn() { return S.sttMode !== 'off'; }
  function sttMode() { return S.sttMode; }
  // 检测当前浏览器是否支持原生 SpeechRecognition（Chrome / Edge 内置；Safari 仅部分版本；微信内置浏览器通常不支持）
  function getBrowserSttCtor() {
    try {
      if (typeof window === 'undefined') return null;
      return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    } catch (e) { return null; }
  }
  function browserSttSupported() { return !!getBrowserSttCtor(); }
  function browserSttLang() { // 浏览器原生默认 zh-CN；保留可改
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
        '<div class="set-head"><span>⚙️ 大模型接口设置</span><button class="set-x" id="set-x">✕</button></div>' +
        '<p class="set-tip">密钥仅保存在你本机浏览器，<b>不会上传到服务器</b>。填好即可用「录音转文字」和「AI 评价」。用 OpenAI 兼容接口，国内可填 DeepSeek / 通义 / Kimi 等。</p>' +
        '<div class="set-sec">' +
          '<h4>🤖 大模型（AI 评价 / 对话）</h4>' +
          '<label class="field"><span class="field-label">预设</span><select id="set-prov">' + Object.keys(PRESETS).map(function (k) { return '<option value="' + k + '">' + PRESETS[k].name + '</option>'; }).join('') + '</select></label>' +
          '<label class="field"><span class="field-label">API Base</span><input id="set-llmBase" placeholder="https://api.xxx.com/v1" autocomplete="off" /></label>' +
          '<label class="field"><span class="field-label">API Key</span><input id="set-llmKey" type="password" placeholder="sk-..." autocomplete="off" /></label>' +
          '<label class="field"><span class="field-label">模型名</span><input id="set-llmModel" placeholder="如 gpt-4o-mini" autocomplete="off" /></label>' +
        '</div>' +
        '<div class="set-sec">' +
          '<h4>🎙 语音转文字（STT）</h4>' +
          '<p class="set-sub">面试间里你说的每句话会自动变成文字、双方都看得到。</p>' +
          '<div class="set-stt-row">' +
            '<label class="set-stt-opt"><input type="radio" name="sttMode" value="api" /> <span><b>Whisper / SenseVoice API</b> · 准确度高，有配额就选这个</span></label>' +
            '<label class="set-stt-opt"><input type="radio" name="sttMode" value="browser" /> <span><b>浏览器自带</b>（Google Chrome / Edge） · 不用 API key、不消耗配额，但不识别英文以外的语言或安静环境</span></label>' +
            '<label class="set-stt-opt"><input type="radio" name="sttMode" value="off" /> <span><b>关闭</b> · 不自动转录，靠手动记笔记</span></label>' +
          '</div>' +
          '<label class="field"><span class="field-label">API Base（Whisper 兼容）</span><input id="set-sttBase" placeholder="留空则用上面的 Base" autocomplete="off" /></label>' +
          '<label class="field"><span class="field-label">API Key（留空则用上面的 Key）</span><input id="set-sttKey" type="password" placeholder="留空则用上面的 Key" autocomplete="off" /></label>' +
          '<label class="field"><span class="field-label">模型名</span><input id="set-sttModel" placeholder="如 whisper-1" autocomplete="off" /></label>' +
          '<p class="set-sub">支持 OpenAI Whisper 兼容接口（OpenAI / Groq / 本地 Whisper / SiliconFlow SenseVoice 等）。</p>' +
        '</div>' +
        '<div class="set-actions">' +
          '<button class="btn-mini grey" id="set-clear">清除全部</button>' +
          '<button class="btn-primary" id="set-save">保存</button>' +
        '</div>' +
        '<p class="set-status" id="set-status" hidden></p>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.getElementById('set-x').addEventListener('click', close);
    document.getElementById('set-prov').addEventListener('change', function () {
      var p = PRESETS[this.value]; if (!p) return;
      document.getElementById('set-llmBase').value = p.llmBase;
      document.getElementById('set-llmModel').value = p.llmModel;
      if (p.sttBase) document.getElementById('set-sttBase').value = p.sttBase;
      if (p.sttModel) document.getElementById('set-sttModel').value = p.sttModel;
    });
    document.getElementById('set-save').addEventListener('click', function () {
      S.provider = document.getElementById('set-prov').value;
      S.llmBase = document.getElementById('set-llmBase').value.trim();
      S.llmKey = document.getElementById('set-llmKey').value.trim();
      S.llmModel = document.getElementById('set-llmModel').value.trim();
      var m = document.querySelector('input[name="sttMode"]:checked');
      S.sttMode = m ? m.value : (S.sttMode || 'api');
      // 兼容旧字段：保留 sttOn 给老代码读
      S.sttOn = (S.sttMode !== 'off');
      S.sttBase = document.getElementById('set-sttBase').value.trim();
      S.sttKey = document.getElementById('set-sttKey').value.trim();
      S.sttModel = document.getElementById('set-sttModel').value.trim();
      save(S);
      var st = document.getElementById('set-status');
      st.hidden = false; st.textContent = '✅ 已保存（仅本机）';
      setTimeout(function () { st.hidden = true; }, 1800);
      if (window.FT && window.FT.onSettingsChange) window.FT.onSettingsChange();
    });
    document.getElementById('set-clear').addEventListener('click', function () {
      if (!confirm('清除本机保存的全部接口设置？')) return;
      S = { provider: 'openai', llmBase: '', llmKey: '', llmModel: '', sttBase: '', sttKey: '', sttModel: '', sttOn: true, sttMode: 'api' };
      save(S); fill(); if (window.FT && window.FT.onSettingsChange) window.FT.onSettingsChange();
    });
  }
  function fill() {
    document.getElementById('set-prov').value = S.provider || 'openai';
    document.getElementById('set-llmBase').value = S.llmBase || '';
    document.getElementById('set-llmKey').value = S.llmKey || '';
    document.getElementById('set-llmModel').value = S.llmModel || '';
    var m = S.sttMode || (S.sttOn ? 'api' : 'off');
    var radios = document.querySelectorAll('input[name="sttMode"]');
    var hit = false;
    radios.forEach(function (r) { if (r.value === m) { r.checked = true; hit = true; } });
    if (!hit && radios[0]) radios[0].checked = true;
    document.getElementById('set-sttBase').value = S.sttBase || '';
    document.getElementById('set-sttKey').value = S.sttKey || '';
    document.getElementById('set-sttModel').value = S.sttModel || '';
  }
  function open() { build(); fill(); var m = document.getElementById('set-mask'); m.style.display = 'flex'; }
  function close() { var m = document.getElementById('set-mask'); if (m) m.style.display = 'none'; }

  window.FTSettings = { get: get, hasLLM: hasLLM, hasSTT: hasSTT, sttOn: sttOn, sttMode: sttMode, browserSttSupported: browserSttSupported, browserSttLang: browserSttLang, open: open, close: close };
})();
