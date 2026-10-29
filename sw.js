/* Nhà Mình — service worker V2.4
   1. Cho phép cài app và mở được giao diện khi mạng chập chờn (chỉ lưu tệp của chính trang này).
   2. Nhận thông báo đẩy: máy chủ chỉ "gõ cửa", service worker tự hỏi máy chủ gia đình nội dung tin rồi hiện thông báo. */
const CACHE = 'nhaminh-v2-4';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './manifest.webmanifest', './icon-192.png', './icon-512.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
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
  if (open && !IOS) return;   // app đang mở trên màn hình: trang tự hiện tin, không cần thông báo
  const cfg = await idbGet('cfg');
  let r = null;
  if (cfg && cfg.api && cfg.token) {
    const since = Math.max(Number(await idbGet('lastAt')) || 0, Number(await idbGet('lastRead')) || 0);
    try { r = await ask(cfg, 'peek', [cfg.token, since]); } catch (err) { r = null; }
  }
  const base = { icon: 'icon-192.png', badge: 'icon-192.png', data: { url: self.registration.scope } };
  if (r && r.call) {
    return self.registration.showNotification('📞 ' + r.call.from + ' đang gọi ' + (r.call.kind === 'video' ? 'video' : 'thoại'),
      Object.assign(base, { body: 'Chạm để mở Nhà Mình và nghe máy', tag: 'nm-call', renotify: true, requireInteraction: true, vibrate: [400, 200, 400, 200, 400] }));
  }
  if (r && r.count && r.items && r.items.length) {
    const items = r.items;
    await idbSet('lastAt', items[items.length - 1].at);
    try { if (self.navigator.setAppBadge) await self.navigator.setAppBadge(r.count); } catch (err) {}
    const urgent = items.filter(i => i.urgent).pop();
    const senders = items.map(i => i.from).filter((x, i, a) => a.indexOf(x) === i);
    let title, body;
    if (urgent) { title = '⚠️ ' + urgent.from + ' cần giúp đỡ'; body = urgent.text; }
    else if (senders.length === 1) { title = senders[0] + (r.count > 1 ? ' · ' + r.count + ' tin mới' : ''); body = items.map(i => i.text).join('\n'); }
    else { title = 'Nhà Mình · ' + r.count + ' tin mới'; body = items.map(i => i.from + ': ' + i.text).join('\n'); }
    return self.registration.showNotification(title, Object.assign(base, { body: body, tag: 'nm-msg', renotify: true, vibrate: [120, 60, 120] }));
  }
  if (r && !r.count) {
    if (open) return;
    return self.registration.showNotification('Nhà Mình', Object.assign(base, { body: 'Có cập nhật mới trong nhóm gia đình', tag: 'nm-msg', silent: true }));
  }
  return self.registration.showNotification('Nhà Mình', Object.assign(base, { body: 'Có tin nhắn mới. Chạm để xem.', tag: 'nm-msg', renotify: true }));
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
