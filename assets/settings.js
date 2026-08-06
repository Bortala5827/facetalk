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
    try { return Object.assign({ provider: 'openai', llmBase: '', llmKey: '', llmModel: '', sttBase: '', sttKey: '', sttModel: '', sttOn: true }, JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return { provider: 'openai', llmBase: '', llmKey: '', llmModel: '', sttBase: '', sttKey: '', sttModel: '', sttOn: true }; }
  }
  function save(s) { localStorage.setItem(KEY, JSON.stringify(s)); }

  var S = load();

  function get() { return S; }
  function hasLLM() { return !!(S.llmBase && S.llmKey && S.llmModel); }
  // STT 的 Base / Key 留空时回退用大模型那一组（和 interview.js 的 sttSend 保持一致），
  // 只有模型名必须单独填（whisper-1 / SenseVoice 等和 chat 模型不同）。
  function hasSTT() {
    if (!S.sttOn) return false;
    var b = S.sttBase || S.llmBase, k = S.sttKey || S.llmKey;
    return !!(b && k && S.sttModel);
  }
  function sttOn() { return !!S.sttOn; }

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
          '<label class="field check"><input id="set-sttOn" type="checkbox" /> <span>开启录音转文字（关闭则面试间不自动转录）</span></label>' +
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
      S.sttOn = document.getElementById('set-sttOn').checked;
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
      S = { provider: 'openai', llmBase: '', llmKey: '', llmModel: '', sttBase: '', sttKey: '', sttModel: '', sttOn: true };
      save(S); fill(); if (window.FT && window.FT.onSettingsChange) window.FT.onSettingsChange();
    });
  }
  function fill() {
    document.getElementById('set-prov').value = S.provider || 'openai';
    document.getElementById('set-llmBase').value = S.llmBase || '';
    document.getElementById('set-llmKey').value = S.llmKey || '';
    document.getElementById('set-llmModel').value = S.llmModel || '';
    document.getElementById('set-sttOn').checked = !!S.sttOn;
    document.getElementById('set-sttBase').value = S.sttBase || '';
    document.getElementById('set-sttKey').value = S.sttKey || '';
    document.getElementById('set-sttModel').value = S.sttModel || '';
  }
  function open() { build(); fill(); var m = document.getElementById('set-mask'); m.style.display = 'flex'; }
  function close() { var m = document.getElementById('set-mask'); if (m) m.style.display = 'none'; }

  window.FTSettings = { get: get, hasLLM: hasLLM, hasSTT: hasSTT, sttOn: sttOn, open: open, close: close };
})();
