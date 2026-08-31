// ============================================================
// FaceTalk 关于弹窗（纯展示）
// 接口配置 / AI 点评已随 v2.10 移除，仅保留产品理念说明。
// 暴露 window.FTSettings.{ open, close }
// ============================================================
(function () {
  var t = function (k, a) { return window.FTI18N ? window.FTI18N.t(k, a) : k; };

  var built = false;
  function build() {
    if (built) return; built = true;
    var wrap = document.createElement('div');
    wrap.className = 'set-mask';
    wrap.id = 'set-mask';
    wrap.innerHTML =
      '<div class="set-modal">' +
        '<div class="set-head"><span>' + t('setTabAbout') + '</span><button class="set-x" id="set-x" type="button" aria-label="' + t('close') + '">✕</button></div>' +
        '<div class="set-panel set-panel-active">' +
          '<div class="set-about">' +
            '<p class="set-about-lead">' + t('setAboutLead') + '</p>' +
            '<div class="set-journey">' +
              '<span><b>' + t('setJourneyMeet') + '</b> ' + t('setJourneyMeetD') + '</span>' +
              '<span><b>' + t('setJourneyTry') + '</b> ' + t('setJourneyTryD') + '</span>' +
              '<span><b>' + t('setJourneyMatch') + '</b> ' + t('setJourneyMatchD') + '</span>' +
              '<span><b>' + t('setJourneyGrow') + '</b> ' + t('setJourneyGrowD') + '</span>' +
            '</div>' +
            '<ul class="set-about-list">' +
              '<li>' + t('setAboutCost') + '</li>' +
              '<li>' + t('setAboutTrust') + '</li>' +
              '<li>' + t('setAboutMatchCost') + '</li>' +
            '</ul>' +
            '<p class="set-about-safe">' + t('setAboutSafe') + '</p>' +
            '<p class="set-about-safe">' + t('setAboutLine') + '</p>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });
    document.getElementById('set-x').addEventListener('click', close);
  }

  // 以当前语言重建弹窗（先移除旧的再重新生成）
  function rebuild() {
    var old = document.getElementById('set-mask');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    built = false;
    build();
  }

  function open() {
    rebuild(); // 每次打开都用当前语言渲染，避免旧语言残留
    var m = document.getElementById('set-mask');
    if (m) m.style.display = 'flex';
  }
  function close() { var m = document.getElementById('set-mask'); if (m) m.style.display = 'none'; }

  // i18n：切换语言时若弹窗已打开，重建并保持打开（保证界面语言一致）
  if (window.FTI18N) window.FTI18N.onChange(function () {
    var mm = document.getElementById('set-mask');
    if (mm && mm.style.display === 'flex') {
      rebuild();
      var m2 = document.getElementById('set-mask');
      if (m2) m2.style.display = 'flex';
    }
  });

  window.FTSettings = { open: open, close: close };
})();
