// Amma: an original cartoon portrait, drawn as inline SVG so it can change mood and animate.
// Single source of truth for the app UI and (via scripts/make-icons.py) the app icons.
// moods: loving | strict | funny | sleepy

const SKIN = '#C98D5F';
const SKIN_SHADE = '#B07348';
const HAIR = '#241410';
const HAIR_LIGHT = '#4B2E22';
const SILK = '#B3145F';
const PEACOCK = '#0C4B47';
const ZARI = '#F2B632';
const KUMKUM = '#C8202F';
const BLUSH = '#E8735A';
const LIP = '#7A2226';

// A ring of jasmine (malli) flowers around the bun.
function jasmineRing() {
  const cx = 200, cy = 52, r = 44, n = 11;
  let out = '';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = (cx + r * Math.cos(a)).toFixed(1);
    const y = (cy + r * Math.sin(a)).toFixed(1);
    out += `<circle cx="${x}" cy="${y}" r="8" fill="#FFFDF5" stroke="#E6D9B8" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="2.8" fill="${ZARI}"/>`;
  }
  return out;
}

const RING = jasmineRing();

const FACE = {
  loving:
    `<g class="m-loving">
      <path d="M146 160 Q166 150 186 158 M214 158 Q234 150 254 160" stroke="${HAIR}" stroke-width="5" stroke-linecap="round" fill="none" opacity=".85"/>
      <path d="M148 188 Q166 170 184 188 M216 188 Q234 170 252 188" stroke="${HAIR}" stroke-width="6" stroke-linecap="round" fill="none"/>
      <path d="M170 232 Q200 262 230 232" stroke="${LIP}" stroke-width="6" stroke-linecap="round" fill="none"/>
    </g>`,
  strict:
    `<g class="m-strict">
      <path d="M144 152 L186 165 M256 152 L214 165" stroke="${HAIR}" stroke-width="6" stroke-linecap="round" fill="none"/>
      <g class="blink"><ellipse cx="166" cy="187" rx="8" ry="10" fill="${HAIR}"/><ellipse cx="234" cy="187" rx="8" ry="10" fill="${HAIR}"/>
      <circle cx="169" cy="183" r="3" fill="#fff"/><circle cx="237" cy="183" r="3" fill="#fff"/></g>
      <path d="M176 240 Q200 232 224 240" stroke="${LIP}" stroke-width="6" stroke-linecap="round" fill="none"/>
    </g>`,
  funny:
    `<g class="m-funny">
      <path d="M146 158 Q166 148 186 156" stroke="${HAIR}" stroke-width="5" stroke-linecap="round" fill="none" opacity=".85"/>
      <path d="M214 146 Q234 134 254 148" stroke="${HAIR}" stroke-width="5" stroke-linecap="round" fill="none" opacity=".85"/>
      <g class="blink"><ellipse cx="166" cy="187" rx="8" ry="10" fill="${HAIR}"/><circle cx="169" cy="183" r="3" fill="#fff"/></g>
      <path d="M218 186 Q234 198 250 186" stroke="${HAIR}" stroke-width="6" stroke-linecap="round" fill="none"/>
      <path d="M166 228 Q200 280 234 228 Z" fill="${LIP}" stroke="${LIP}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M172 231 Q200 241 228 231 L226 237 Q200 248 174 237 Z" fill="#FFFDF5"/>
      <path d="M184 252 Q200 268 216 252 Q200 259 184 252 Z" fill="${BLUSH}"/>
    </g>`,
  sleepy:
    `<g class="m-sleepy">
      <path d="M146 162 Q166 156 186 162 M214 162 Q234 156 254 162" stroke="${HAIR}" stroke-width="5" stroke-linecap="round" fill="none" opacity=".8"/>
      <path d="M148 184 Q166 198 184 184 M216 184 Q234 198 252 184" stroke="${HAIR}" stroke-width="6" stroke-linecap="round" fill="none"/>
      <path d="M182 236 Q200 248 218 236" stroke="${LIP}" stroke-width="6" stroke-linecap="round" fill="none"/>
      <text class="zz" x="306" y="128" font-family="'Baloo Thambi 2',sans-serif" font-size="40" font-weight="800" fill="${ZARI}">z</text>
      <text class="zz zz2" x="336" y="92" font-family="'Baloo Thambi 2',sans-serif" font-size="26" font-weight="800" fill="${ZARI}">z</text>
    </g>`,
};

export const MOODS = Object.keys(FACE);

/**
 * @param {'loving'|'strict'|'funny'|'sleepy'} mood
 * @param {{label?: string, decorative?: boolean}} opts
 */
export function ammaSvg(mood = 'loving', opts = {}) {
  const m = FACE[mood] ? mood : 'loving';
  const label = String(opts.label || 'Amma').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const a11y = opts.decorative ? 'aria-hidden="true"' : `role="img" aria-label="${label}"`;
  return `<svg class="amma" data-mood="${m}" viewBox="0 0 400 420" xmlns="http://www.w3.org/2000/svg" ${a11y}>
  <g class="breathe">
    <circle cx="200" cy="54" r="40" fill="${HAIR}"/>
    <ellipse cx="200" cy="184" rx="112" ry="116" fill="${HAIR}"/>
    <path d="M176 42 Q192 30 214 34" stroke="${HAIR_LIGHT}" stroke-width="7" fill="none" stroke-linecap="round" opacity=".8"/>
    ${RING}
    <path d="M22 420 C30 340 98 306 200 306 C302 306 370 340 378 420 Z" fill="${SILK}"/>
    <path d="M124 322 C150 306 178 306 200 326 C244 366 296 396 326 420 L246 420 C232 384 206 354 172 340 C152 332 136 328 124 322 Z" fill="${PEACOCK}"/>
    <path d="M124 322 C136 328 152 332 172 340 C206 354 232 384 246 420" stroke="${ZARI}" stroke-width="6" fill="none" stroke-linecap="round"/>
    <rect x="176" y="246" width="48" height="76" rx="22" fill="${SKIN_SHADE}"/>
    <path d="M150 308 C168 306 180 309 200 309 C220 309 232 306 250 308 C246 338 226 352 200 352 C174 352 154 338 150 308 Z" fill="${SKIN}"/>
    <path d="M150 308 C154 338 174 352 200 352 C226 352 246 338 250 308" stroke="${ZARI}" stroke-width="4" fill="none"/>
    <path d="M166 322 Q200 362 234 322" stroke="${ZARI}" stroke-width="4" fill="none" stroke-linecap="round"/>
    <circle cx="200" cy="344" r="6" fill="${ZARI}"/>
    <ellipse cx="113" cy="198" rx="13" ry="20" fill="${SKIN}"/><ellipse cx="287" cy="198" rx="13" ry="20" fill="${SKIN}"/>
    <circle cx="113" cy="216" r="7" fill="${ZARI}"/><circle cx="113" cy="232" r="5" fill="${ZARI}"/>
    <circle cx="287" cy="216" r="7" fill="${ZARI}"/><circle cx="287" cy="232" r="5" fill="${ZARI}"/>
    <path d="M114 176 C114 108 286 108 286 176 C286 246 246 288 200 288 C154 288 114 246 114 176 Z" fill="${SKIN}"/>
    <path d="M108 184 C100 96 150 66 200 66 C250 66 300 96 292 184 C280 142 246 120 200 120 C154 120 120 142 108 184 Z" fill="${HAIR}"/>
    <path d="M200 70 L200 114" stroke="${HAIR_LIGHT}" stroke-width="3" opacity=".7"/>
    <circle cx="200" cy="148" r="8" fill="${KUMKUM}"/><circle cx="198" cy="145.5" r="2" fill="#fff" opacity=".55"/>
    <ellipse cx="146" cy="224" rx="18" ry="12" fill="${BLUSH}" opacity=".34"/><ellipse cx="254" cy="224" rx="18" ry="12" fill="${BLUSH}" opacity=".34"/>
    <path d="M194 207 Q200 216 208 209" stroke="#9A6038" stroke-width="4" fill="none" stroke-linecap="round"/>
    <circle cx="211" cy="212" r="3.6" fill="${ZARI}"/>
    ${FACE[m]}
    <path class="heart" d="M330 150 c-7 -12 -26 -5 -19 9 c5 9 19 16 19 16 s14 -7 19 -16 c7 -14 -12 -21 -19 -9z" fill="#E8456E"/>
  </g>
</svg>`;
}
