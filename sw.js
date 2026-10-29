/* Nhà Mình — service worker V2.5
   1. Cho phép cài app và mở được giao diện khi mạng chập chờn (chỉ lưu tệp của chính trang này).
   2. Nhận thông báo đẩy: máy chủ chỉ "gõ cửa", service worker tự hỏi máy chủ gia đình nội dung tin rồi hiện thông báo. */
const CACHE = 'nhaminh-v2-5';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon-192.png', './icon-512.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  // trang chính luôn hỏi lại máy chủ (cache: 'no-cache') để bản mới có hiệu lực ngay
  e.respondWith(fetch(e.request, e.request.mode === 'navigate' ? { cache: 'no-cache' } : undefined).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./'))));
});

/* ---------- bộ nhớ nhỏ dùng chung với trang (IndexedDB) ---------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('nhaminh', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function idbGet(k) {
  return idb().then(d => new Promise(res => {
    const q = d.transaction('kv').objectStore('kv').get(k);
    q.onsuccess = () => res(q.result); q.onerror = () => res(undefined);
  })).catch(() => undefined);
}
function idbSet(k, v) {
  return idb().then(d => new Promise(res => {
    const tx = d.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k);
    tx.oncomplete = tx.onerror = () => res();
  })).catch(() => {});
}
function ask(cfg, fn, args) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 9000);
  return fetch(cfg.api, {
    method: 'POST', redirect: 'follow', signal: ctl.signal,
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn: fn, args: args })
  }).then(r => r.json()).then(o => { clearTimeout(t); if (!o || !o.ok) throw new Error((o && o.err) || 'lỗi'); return o.val; });
}

/* ---------- nhận thông báo ---------- */
const IOS = /iPad|iPhone|iPod|Macintosh/.test(self.navigator.userAgent || '');
self.addEventListener('push', e => e.waitUntil(onPush()));
async function onPush() {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = wins.some(c => c.visibilityState === 'visible' && c.focused);
  wins.forEach(c => c.postMessage({ t: 'push' }));   // trang còn chạy ngầm thì cập nhật tin ngay
  if (open && !IOS) return;   // app đang mở trên màn hình: trang tự hiện tin và kêu "ting"
  const cfg = await idbGet('cfg');
  let r = null;
  if (cfg && cfg.api && cfg.token) {
    // đếm từ lần đọc cuối trên máy này; máy mới chưa đọc lần nào thì chỉ tính 1 ngày gần nhất
    const read = Number(await idbGet('lastRead')) || (Date.now() - 86400000);
    const shown = Math.max(read, Number(await idbGet('lastAt')) || 0);
    try { r = await ask(cfg, 'peek', [cfg.token, read, shown]); } catch (err) { r = null; }
  }
  const base = { icon: 'icon-192.png', badge: 'icon-192.png', data: { url: self.registration.scope }, timestamp: Date.now(), silent: false };
  if (r && r.call) {
    return self.registration.showNotification('📞 ' + r.call.from + ' đang gọi ' + (r.call.kind === 'video' ? 'video' : 'thoại') + '…',
      Object.assign(base, { body: 'Chạm để mở Nhà Mình và nghe máy', tag: 'nm-call', renotify: true, requireInteraction: true,
        vibrate: [1000, 400, 1000, 400, 1000, 400, 1000] }));
  }
  if (r) await closeTag('nm-call');   // hết đổ chuông: bỏ thông báo "đang gọi"
  try {
    if (r && self.navigator.setAppBadge) await (r.count ? self.navigator.setAppBadge(r.count) : self.navigator.clearAppBadge());
  } catch (err) {}
  if (r && r.count && r.items && r.items.length) {
    const items = r.items, n = r.count, fresh = r.fresh == null ? n : r.fresh;
    await idbSet('lastAt', items[items.length - 1].at);
    const urgent = items.filter(i => i.urgent).pop();
    const senders = items.map(i => i.from).filter((x, i, a) => a.indexOf(x) === i);
    const more = n > items.length ? '\n… và ' + (n - items.length) + ' tin khác' : '';
    let title, body;
    if (urgent) { title = '🆘 ' + urgent.from + ' cần giúp đỡ'; body = urgent.text + (n > 1 ? '\n(' + n + ' tin chưa đọc)' : ''); }
    else if (n === 1) { title = items[0].from; body = items[0].text; }
    else if (senders.length === 1) { title = senders[0] + ' · ' + n + ' tin nhắn mới'; body = items.map(i => i.text).join('\n') + more; }
    else { title = 'Nhà Mình · ' + n + ' tin nhắn mới'; body = items.map(i => i.from + ': ' + i.text).join('\n') + more; }
    return self.registration.showNotification(title, Object.assign(base, {
      body: body, tag: urgent ? 'nm-help' : 'nm-msg', renotify: fresh > 0, silent: fresh === 0,
      requireInteraction: !!urgent,
      vibrate: urgent ? [500, 200, 500, 200, 500, 200, 500] : [300, 150, 300, 150, 300]
    }));
  }
  if (r && !r.count) {
    await closeTag('nm-msg');
    if (open) return;
    return self.registration.showNotification('Nhà Mình', Object.assign(base, { body: 'Có cập nhật mới trong nhóm gia đình', tag: 'nm-msg', silent: true }));
  }
  return self.registration.showNotification('Nhà Mình', Object.assign(base, { body: 'Có tin nhắn mới. Chạm để xem.', tag: 'nm-msg', renotify: true, vibrate: [300, 150, 300] }));
}
async function closeTag(tag) {
  try { (await self.registration.getNotifications({ tag: tag })).forEach(n => n.close()); } catch (err) {}
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const c of ws) {
      if ('focus' in c) { c.postMessage({ t: 'push' }); return c.focus(); }
    }
    return self.clients.openWindow(self.registration.scope);
  }));
});

/* trình duyệt tự đổi địa chỉ nhận thông báo: đăng ký lại với máy chủ gia đình */
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const cfg = await idbGet('cfg');
    if (!cfg || !cfg.vapid) return;
    const b = atob(cfg.vapid.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((cfg.vapid.length + 3) % 4));
    const key = Uint8Array.from(b, ch => ch.charCodeAt(0));
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await ask(cfg, 'pushSubscribe', [cfg.token, JSON.parse(JSON.stringify(sub)), new URL(self.registration.scope).origin]);
  })().catch(() => {}));
});
