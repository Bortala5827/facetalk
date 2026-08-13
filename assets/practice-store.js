// practice-store.js — 可复用本地存储（练习日志 + 自定义题库）
// 纯前端 / IndexedDB / 无第三方依赖。可被任意 Speak Series 产品 drop-in 复用：
//   1) 在页面引入 <script src="/assets/practice-store.js"></script>
//   2) 用 window.RCJPracticeStore 调用下方方法
// 数据全部在用户本机浏览器，不联网、不上传；清缓存 / 换设备即丢失，需配合导出。
(function (global) {
  'use strict';

  var DB_NAME = 'rcj_practice';
  var DB_VER = 1;
  var STORE_SESSIONS = 'sessions';   // 练习日志：{id,createdAt,cat,catLabel,q,durMs,audioBlob,rating,note}
  var STORE_TOPICS = 'customTopics'; // 用户自定义题库：{id,createdAt,q}

  var _db = null;
  function open() {
    if (_db) return _db;
    _db = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_SESSIONS))
          db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_TOPICS))
          db.createObjectStore(STORE_TOPICS, { keyPath: 'id' });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _db;
  }

  function uid() {
    return (global.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  function tx(store, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, mode);
        var os = t.objectStore(store);
        var result;
        var req = fn(os);
        if (req && typeof req.onsuccess === 'function') req.onsuccess = function () { result = req.result; };
        t.oncomplete = function () { resolve(result); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  // ── 练习日志 ──
  function addSession(s) {
    var row = Object.assign({ id: uid(), createdAt: Date.now(), rating: 0, note: '' }, s);
    return tx(STORE_SESSIONS, 'readwrite', function (os) { return os.put(row); }).then(function () { return row; });
  }
  function getAllSessions() {
    return tx(STORE_SESSIONS, 'readonly', function (os) { return os.getAll(); })
      .then(function (rows) { return (rows || []).sort(function (a, b) { return b.createdAt - a.createdAt; }); });
  }
  function getSession(id) {
    return tx(STORE_SESSIONS, 'readonly', function (os) { return os.get(id); });
  }
  function deleteSession(id) {
    return tx(STORE_SESSIONS, 'readwrite', function (os) { return os.delete(id); });
  }
  function updateSession(id, patch) {
    return getSession(id).then(function (row) {
      if (!row) return null;
      var merged = Object.assign({}, row, patch);
      return tx(STORE_SESSIONS, 'readwrite', function (os) { return os.put(merged); }).then(function () { return merged; });
    });
  }

  // ── 自定义题库 ──
  function addCustomTopics(list) {
    var rows = (list || []).map(function (q) { return { id: uid(), q: q, createdAt: Date.now() }; });
    return Promise.all(rows.map(function (r) {
      return tx(STORE_TOPICS, 'readwrite', function (os) { return os.put(r); });
    })).then(function () { return rows.length; });
  }
  function getCustomTopics() {
    return tx(STORE_TOPICS, 'readonly', function (os) { return os.getAll(); })
      .then(function (r) { return r || []; });
  }
  function clearCustomTopics() {
    return open().then(function (db) {
      return new Promise(function (resolve) {
        var t = db.transaction(STORE_TOPICS, 'readwrite');
        t.objectStore(STORE_TOPICS).clear();
        t.oncomplete = function () { resolve(); };
      });
    });
  }

  global.RCJPracticeStore = {
    addSession: addSession,
    getAllSessions: getAllSessions,
    getSession: getSession,
    updateSession: updateSession,
    deleteSession: deleteSession,
    addCustomTopics: addCustomTopics,
    getCustomTopics: getCustomTopics,
    clearCustomTopics: clearCustomTopics
  };
})(window);
