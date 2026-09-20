const CACHE = 'ammmaa-v5';
const LOCAL = 'ammmaa-local'; // the person's own photo (never deleted when the app updates)
const SHELL = ['/', '/index.html', '/app.js', '/shared.js', '/amma.js', '/voice.js', '/own.js', '/chat.js', '/style.css', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ammmaa-v') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Stale-while-revalidate for the app shell and fonts. API calls always hit the network.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !isFont) return;
  if (url.pathname.startsWith('/api/')) return;
  if (url.pathname === '/local/amma.jpg') {
    event.respondWith(caches.open(LOCAL).then((c) => c.match('/local/amma.jpg')).then((r) => r || new Response('', { status: 404 })));
    return;
  }
  if (url.pathname.startsWith('/voice/')) return; // audio is streamed by the browser itself

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (cached) return cached;
      const res = await network;
      if (res) return res;
      if (req.mode === 'navigate') return (await cache.match('/index.html')) || Response.error();
      return Response.error();
    }),
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const actions = data.actions
    ? [
        { action: 'done', title: data.actions.done },
        { action: 'later', title: data.actions.later },
      ]
    : [];
  event.waitUntil(
    // If the person added their own Amma's photo, it becomes the notification picture.
    caches
      .open(LOCAL)
      .then((c) => c.match('/local/amma.jpg'))
      .catch(() => null)
      .then((photo) =>
        self.registration.showNotification(data.title || 'Ammmaa', {
          body: data.body || '',
          icon: photo ? '/local/amma.jpg' : '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
          tag: data.kind || 'ammmaa',
          renotify: true,
          lang: 'ta',
          actions,
          data: { id: data.id, kind: data.kind, sig: data.sig, text: data.body || '' },
        }),
      ),
  );
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  n.close();
  if (event.action === 'later') {
    event.waitUntil(
      fetch('/api/snooze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: n.data.id, kind: n.data.kind, sig: n.data.sig, minutes: 30 }),
      }).catch(() => {}),
    );
    return;
  }
  if (event.action === 'done') return;
  // Opening the app from a reminder lets Amma say that reminder out loud (a tap is needed before browsers allow sound).
  const kind = (n.data && n.data.kind) || '';
  const text = (n.data && n.data.text) || '';
  const url = kind ? `/?hear=${encodeURIComponent(kind)}&t=${encodeURIComponent(text)}` : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.postMessage({ type: 'hear', kind, text });
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
