// Timezone math using only Intl, so it runs in Workers, Node and browsers.
const fmtCache = new Map();

function fmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function isValidTz(tz) {
  if (typeof tz !== 'string' || tz.length > 64) return false;
  try {
    fmt(tz);
    return true;
  } catch {
    return false;
  }
}

export function localParts(ms, tz) {
  const o = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = parseInt(p.value, 10);
  return { y: o.year, m: o.month, d: o.day, h: o.hour === 24 ? 0 : o.hour, min: o.minute, s: o.second };
}

export function tzOffsetMs(ms, tz) {
  const p = localParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(ms / 1000) * 1000;
}

export function localToUtc(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const t1 = guess - tzOffsetMs(guess, tz);
  return guess - tzOffsetMs(t1, tz);
}

const pad = (n) => String(n).padStart(2, '0');

export function localDateStr(ms, tz) {
  const p = localParts(ms, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

export function localMinutes(ms, tz) {
  const p = localParts(ms, tz);
  return p.h * 60 + p.min;
}

export function hhmmToMin(s) {
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
}

// Next UTC instant strictly after `afterMs` at local time hh:mm (optionally on weekday `dow`, 0=Sunday).
export function nextOccurrence(hhmm, tz, afterMs, dow = null) {
  const hh = Number(hhmm.slice(0, 2)), mm = Number(hhmm.slice(3));
  const base = localParts(afterMs, tz);
  for (let i = 0; i <= 8; i++) {
    const dt = new Date(Date.UTC(base.y, base.m - 1, base.d + i));
    if (dow !== null && dow !== undefined && dt.getUTCDay() !== dow) continue;
    const t = localToUtc(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate(), hh, mm, tz);
    if (t > afterMs) return t;
  }
  return null;
}

// Quiet hours can wrap past midnight (22:00 -> 07:00).
export function inQuiet(minOfDay, startHHMM, endHHMM) {
  const s = hhmmToMin(startHHMM), e = hhmmToMin(endHHMM);
  if (s === e) return false;
  return s < e ? minOfDay >= s && minOfDay < e : minOfDay >= s || minOfDay < e;
}
