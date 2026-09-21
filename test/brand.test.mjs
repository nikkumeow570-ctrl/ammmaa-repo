import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { icon, ICON_NAMES } from '../public/icons.js';
import { TITLES, KINDS } from '../public/shared.js';

const pub = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
const root = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('brand: the visible name is Anbudan Amma everywhere people can see it', () => {
  // Internal keys such as "ammmaa.v1" are lower case on purpose (renaming them would sign people out); the capitalised old name must be gone.
  for (const f of readdirSync(new URL('../public/', import.meta.url)).filter((n) => /\.(html|js|webmanifest)$/.test(n))) {
    assert.ok(!/Ammmaa/.test(pub(f)), `${f} still shows the old name`);
  }
  const manifest = JSON.parse(pub('manifest.webmanifest'));
  assert.equal(manifest.name, 'Anbudan Amma');
  assert.equal(manifest.short_name, 'Anbudan Amma');
  assert.match(pub('index.html'), /<title>Anbudan Amma<\/title>/);
  assert.equal(TITLES.en, 'Anbudan Amma');
  assert.equal(TITLES.tanglish, 'Anbudan Amma');
  assert.equal(TITLES.ta, 'அன்புடன் அம்மா');
});

test('icons: every icon the app asks for exists, and each renders an accessible-hidden svg', () => {
  const asked = new Set();
  for (const f of ['app.js', 'chat.js']) for (const m of pub(f).matchAll(/icon\('([a-z]+)'/g)) asked.add(m[1]);
  for (const m of pub('app.js').matchAll(/\['(home|chat|reminders|more)', '[A-Za-z]+', '([a-z]+)'\]/g)) asked.add(m[2]);
  for (const k of ['meals', 'water', 'breaks', 'call', 'bedtime', 'morning', 'meal', 'break']) asked.add(k);
  assert.ok(asked.size >= 12);
  for (const name of asked) {
    assert.ok(ICON_NAMES.includes(name), `missing icon: ${name}`);
    assert.match(icon(name), /^<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><(path|circle|rect)/);
  }
  assert.equal(icon('nope').includes('<path'), false, 'an unknown name renders an empty svg, not an error');
  assert.ok(KINDS.every((k) => ICON_NAMES.includes(k)), 'every reminder kind has an icon');
});

test('licence: MIT is present, named in package.json, and the notice says what it does not cover', () => {
  assert.match(root('LICENSE'), /^MIT License\n\nCopyright \(c\) 2026 /);
  assert.match(root('LICENSE'), /Permission is hereby granted, free of charge/);
  assert.equal(JSON.parse(root('package.json')).license, 'MIT');
  const notice = root('NOTICE.md');
  assert.match(notice, /not covered by the MIT licence/);
  assert.match(notice, /Manrope/);
  assert.match(notice, /Anbudan Amma/);
  assert.ok(existsSync(new URL('../LICENSE', import.meta.url)));
});

// ---- design tokens: keep text readable in both themes (WCAG AA, 4.5:1) ----
function tokens(css, block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function themes() {
  const css = pub('style.css');
  const light = tokens(css, css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {'))));
  const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
  const darkBlock = css.slice(css.indexOf(':root {', darkStart), css.indexOf('}', css.indexOf(':root {', darkStart)));
  return { light, dark: { ...light, ...tokens(css, darkBlock) } };
}
const resolve = (t, name) => {
  let v = t[name];
  for (let i = 0; i < 4 && /^var\(--/.test(v); i++) v = t[/var\(--([a-z0-9-]+)\)/.exec(v)[1]];
  return v;
};
const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

test('design: text and buttons keep at least 4.5:1 contrast in the light and the dark theme', () => {
  const pairs = [
    ['text', 'bg'], ['text', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-2'],
    ['on-brand', 'brand'], ['brand', 'brand-soft'], ['on-accent', 'accent'], ['rose', 'surface'], ['rose', 'rose-soft'],
    ['on-primary', 'primary'], ['text', 'accent-soft'],
  ];
  const { light, dark } = themes();
  for (const [name, t] of [['light', light], ['dark', dark]]) {
    for (const [fg, bg] of pairs) {
      const a = resolve(t, fg), b = resolve(t, bg);
      assert.match(a, /^#[0-9a-f]{6}$/i, `${name}: --${fg} is a plain hex colour`);
      assert.match(b, /^#[0-9a-f]{6}$/i, `${name}: --${bg} is a plain hex colour`);
      assert.ok(ratio(a, b) >= 4.5, `${name}: --${fg} on --${bg} is only ${ratio(a, b).toFixed(2)}:1`);
    }
  }
});
