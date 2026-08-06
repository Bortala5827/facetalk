// ============================================================
// FaceTalk ft_me 身份持久化工具（v2.3 修复无痕/隐私模式丢身份）
// 读取优先级：URL ?me= → localStorage → Cookie
// 写入：localStorage + Cookie 双写（Cookie 在无痕/Safari隐私刷新后仍在）
// 暴露 window.FTMe.{get, set, del, cookieGet}
// ============================================================
(function () {
  var KEY = 'ft_me';
  var COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 天

  function cookieGet(name) {
    try {
      var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
      return m ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }
  function cookieSet(name, val) {
    try {
      document.cookie = name + '=' + encodeURIComponent(val) +
        '; max-age=' + COOKIE_MAX_AGE + '; path=/; SameSite=Lax';
    } catch (e) {}
  }
  function cookieDel(name) {
    try { document.cookie = name + '=; max-age=0; path=/'; } catch (e) {}
  }

  function get() {
    // 1) localStorage（正常浏览主路径）
    try {
      var ls = localStorage.getItem(KEY);
      if (ls) return ls;
    } catch (e) {}
    // 2) Cookie（无痕/Safari隐私模式：写入可能被禁，但读/会话级在刷新后仍在）
    return cookieGet(KEY);
  }

  function set(val) {
    if (!val) return;
    try { localStorage.setItem(KEY, val); } catch (e) {}
    cookieSet(KEY, val);
  }

  function del() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    cookieDel(KEY);
  }

  window.FTMe = {
    get: get,
    set: set,
    del: del,
    cookieGet: cookieGet,
  };
})();
