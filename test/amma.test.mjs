import test from 'node:test';
import assert from 'node:assert/strict';
import { ammaSvg, MOODS } from '../public/amma.js';

const count = (s, re) => (s.match(re) || []).length;

test('amma: every mood renders a well-formed, accessible SVG', () => {
  assert.deepEqual([...MOODS].sort(), ['funny', 'loving', 'sleepy', 'strict']);
  for (const mood of MOODS) {
    const svg = ammaSvg(mood, { label: 'Amma' });
    assert.ok(svg.startsWith('<svg'), mood);
    assert.ok(svg.includes(`data-mood="${mood}"`), mood);
    assert.ok(svg.includes('role="img"') && svg.includes('aria-label="Amma"'), mood);
    assert.equal(count(svg, /<svg\b/g), 1);
    assert.equal(count(svg, /<\/svg>/g), 1);
    assert.equal(count(svg, /<g\b/g), count(svg, /<\/g>/g), `balanced <g> in ${mood}`);
    assert.ok(!/undefined|NaN|null/.test(svg), `no bad values in ${mood}`);
    assert.ok(!/\sid="/.test(svg), 'no ids, so several Ammas can share a page');
  }
});

test('amma: decorative mode hides it from screen readers; unknown mood falls back; labels are escaped', () => {
  const deco = ammaSvg('loving', { decorative: true });
  assert.ok(deco.includes('aria-hidden="true"') && !deco.includes('role="img"'));
  assert.ok(ammaSvg('nonsense').includes('data-mood="loving"'));
  assert.ok(!ammaSvg('loving', { label: 'x"><script>' }).includes('<script>'));
});
