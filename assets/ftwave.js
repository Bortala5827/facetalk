// ftwave.js — FaceTalk 复用 rcj-audio-core 的实时频谱柱状图（非模块全局版）
// 暴露 window.RCJWave = { mountLiveBars, fitCanvas }
// v2：在 v1 单色基础上，新增 colorFn / gradient / wobble / pulse 情绪化着色与动效
//     （与 Speak Series 共享波形模块同代，API 完全向后兼容，旧调用不破）
(function (global) {
  function fitCanvas(canvas, cssHeight) {
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || (canvas.parentElement && canvas.parentElement.clientWidth) || 320;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round((cssHeight || 60) * dpr);
    canvas.style.width = '100%';
    canvas.style.height = (cssHeight || 60) + 'px';
  }

  function roundRect(ctx, x, y, w, h, r) {
    var maxR = Math.min(Math.abs(w), Math.abs(h)) / 2;
    var tr = Math.min(r.tr || 0, maxR), br = Math.min(r.br || 0, maxR), bl = Math.min(r.bl || 0, maxR), tl = Math.min(r.tl || 0, maxR);
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
    ctx.lineTo(x + w, y + h - br);
    ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    ctx.lineTo(x + bl, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
    ctx.lineTo(x, y + tl);
    ctx.quadraticCurveTo(x, y, x + tl, y);
    ctx.closePath();
  }

  // 两个 #rrggbb 按比例 t(0..1) 插值，用于 gradient / colorFn 音量着色
  function lerpHex(a, b, t) {
    t = Math.max(0, Math.min(1, t));
    var pa = hexToRgb(a), pb = hexToRgb(b);
    if (!pa || !pb) return a;
    var r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
    var g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
    var bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }
  function hexToRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (h.length !== 6) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function mountLiveBars(canvas, analyser, opts) {
    opts = opts || {};
    var color = opts.color || '#7b8fc4';
    var colorFn = opts.colorFn || null;        // (v, i, n) => cssColor，优先于 color / gradient
    var gradient = opts.gradient || null;       // [c1, c2] 跨整片场由 c1→c2 渐变
    var barGap = opts.barGap != null ? opts.barGap : 1.5;
    var smoothing = opts.smoothing != null ? opts.smoothing : 0.7;
    var minBarHeight = opts.minBarHeight != null ? opts.minBarHeight : 2;
    var alpha = opts.alpha != null ? opts.alpha : 0.85;
    var capAlpha = opts.capAlpha != null ? opts.capAlpha : 0.4;
    var capDecay = opts.capDecay != null ? opts.capDecay : 0.96;
    var borderRadius = opts.borderRadius != null ? opts.borderRadius : 2;
    var wobble = opts.wobble != null ? opts.wobble : 0;   // 0..1 随机高度抖动（急躁/颤抖）
    var pulse = opts.pulse != null ? opts.pulse : 0;       // 0..1 整体呼吸律动（能量/情绪感）
    var ctx = canvas.getContext('2d');
    var freqCount = analyser.frequencyBinCount;
    var data = new Uint8Array(freqCount);
    analyser.smoothingTimeConstant = smoothing;
    var raf, caps = new Float32Array(freqCount);
    function draw() {
      analyser.getByteFrequencyData(data);
      var w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      var visibleBins = Math.floor(freqCount * 0.45);
      var step = Math.max(1, Math.floor(visibleBins / 64));
      var barW = Math.max(2, (w / (visibleBins / step)) - barGap);
      var beat = pulse ? (1 + pulse * 0.35 * Math.sin(Date.now() / 170)) : 1;
      for (var i = 0; i < visibleBins; i += step) {
        var v = data[i] / 255;
        if (pulse) v = v * beat;
        if (wobble) v = v * (1 + wobble * (Math.random() - 0.5));
        v = Math.max(0, Math.min(1, v));
        var barH = Math.max(minBarHeight, v * h * 0.9);
        var x = (i / visibleBins) * w + barGap / 2;
        if (v * h > caps[i]) caps[i] = v * h; else caps[i] *= capDecay;
        // 取色：colorFn > gradient > color
        var col = color;
        if (colorFn) col = colorFn(v, i, visibleBins);
        else if (gradient) col = lerpHex(gradient[0], gradient[1], i / visibleBins);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = col;
        roundRect(ctx, x, h - barH, barW, barH, { tl: borderRadius, tr: borderRadius, br: 0, bl: 0 });
        ctx.fill();
        if (caps[i] > minBarHeight + 1) {
          ctx.globalAlpha = capAlpha;
          ctx.fillStyle = col;
          ctx.fillRect(x, h - caps[i], barW, 1.5);
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);
    return function () { cancelAnimationFrame(raf); };
  }

  global.RCJWave = { mountLiveBars: mountLiveBars, fitCanvas: fitCanvas, lerpHex: lerpHex };
})(window);
