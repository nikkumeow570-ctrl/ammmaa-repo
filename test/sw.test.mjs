import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

// Runs public/sw.js in a sandbox with a fake service-worker environment.
function boot({ caches: cacheData = {}, clientsList = [] } = {}) {
  const listeners = {};
  const store = new Map(Object.entries(cacheData).map(([k, v]) => [k, new Map(Object.entries(v))]));
  const shown = [];
  const opened = [];
  const deleted = [];
  const caches = {
    keys: async () => [...store.keys()],
    delete: async (k) => (deleted.push(k), store.delete(k)),
    open: async (name) => {
      if (!store.has(name)) store.set(name, new Map());
      const m = store.get(name);
      return { match: async (req) => m.get(typeof req === 'string' ? req : new URL(req.url).pathname), put: async (req, res) => m.set(typeof req === 'string' ? req : new URL(req.url).pathname, res), addAll: async () => {} };
    },
  };
  const self = {
    location: { origin: 'https://app.test' },
    addEventListener: (t, fn) => (listeners[t] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => clientsList, openWindow: async (u) => opened.push(u) },
    registration: { showNotification: async (title, opts) => shown.push({ title, opts }) },
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, caches, fetch: async () => new Response('net'), URL, Response, Promise, console });
  const fire = async (type, ev) => {
    const waits = [];
    listeners[type]({ ...ev, waitUntil: (p) => waits.push(p), respondWith: (p) => waits.push(p) });
    return Promise.all(waits);
  };
  return { fire, shown, opened, deleted, store, listeners };
}
const req = (path) => ({ method: 'GET', url: `https://app.test${path}`, mode: 'no-cors' });

test('sw: updating the app removes old app caches but never the person\'s own photo', async () => {
  const sw = boot({ caches: { 'ammmaa-v1': {}, 'ammmaa-v3': {}, 'ammmaa-v4': {}, 'ammmaa-local': { '/local/amma.jpg': 'photo' } } });
  await sw.fire('activate', {});
  assert.deepEqual(sw.deleted.sort(), ['ammmaa-v1', 'ammmaa-v3']);
  assert.ok(sw.store.has('ammmaa-local') && sw.store.has('ammmaa-v4'));
});

test('sw: /local/amma.jpg comes from the local cache, audio and the API are left to the network', async () => {
  const sw = boot({ caches: { 'ammmaa-local': { '/local/amma.jpg': new Response('jpegbytes') } } });
  const [res] = await sw.fire('fetch', { request: req('/local/amma.jpg') });
  assert.equal(await res.text(), 'jpegbytes');
  const [none] = await boot().fire('fetch', { request: req('/local/amma.jpg') });
  assert.equal(none.status, 404);
  for (const path of ['/voice/en/abc.mp3', '/api/status']) {
    const handled = [];
    sw.listeners.fetch({ request: req(path), respondWith: (p) => handled.push(p) });
    assert.equal(handled.length, 0, `${path} must not be answered by the service worker`);
  }
});

test('sw: a reminder shows Amma\'s icon, or the person\'s own photo when they added one', async () => {
  const payload = { data: { json: () => ({ title: 'Amma', body: 'Saaptiya kanna?', kind: 'meal', id: 'x', sig: 's', actions: { done: 'Sari Amma', later: 'Apparam' } }) } };
  let sw = boot();
  await sw.fire('push', payload);
  assert.equal(sw.shown[0].opts.icon, '/icons/icon-192.png');
  assert.equal(sw.shown[0].opts.data.text, 'Saaptiya kanna?');
  sw = boot({ caches: { 'ammmaa-local': { '/local/amma.jpg': new Response('x') } } });
  await sw.fire('push', payload);
  assert.equal(sw.shown[0].opts.icon, '/local/amma.jpg');
});

test('sw: tapping a reminder opens the app so Amma can say it, or tells the open app to', async () => {
  const note = (action = '') => ({ action, notification: { close() {}, data: { id: 'x', kind: 'meal', sig: 's', text: 'Saaptiya kanna?' } } });
  let sw = boot();
  await sw.fire('notificationclick', note());
  assert.equal(sw.opened[0], '/?hear=meal&t=Saaptiya%20kanna%3F');
  const messages = [];
  sw = boot({ clientsList: [{ focus: async () => 'focused', postMessage: (m) => messages.push(m) }] });
  await sw.fire('notificationclick', note());
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'hear', kind: 'meal', text: 'Saaptiya kanna?' }]); // (round-trip because the sandbox has its own Object type)
  assert.equal(sw.opened.length, 0);
  sw = boot();
  await sw.fire('notificationclick', note('done'));
  assert.equal(sw.opened.length, 0, 'the Done button does not open the app');
});
