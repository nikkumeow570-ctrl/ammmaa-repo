// Shared by the PWA (browser) and the Worker (server). Pure functions only.
// NOTE: the Tamil lines below were written by an AI. Have a native speaker read
// every line before you ship. Editing this file is the easiest way to give Amma
// your own voice.

export const LANGS = [
  { id: 'ta', label: 'தமிழ்' },
  { id: 'tanglish', label: 'Tanglish' },
  { id: 'en', label: 'English' },
];

export const TONES = [
  { id: 'loving', label: 'Loving' },
  { id: 'strict', label: 'Strict' },
  { id: 'funny', label: 'Funny' },
];

export const KINDS = ['meal', 'water', 'break', 'call', 'bedtime', 'morning'];

export const TITLES = { ta: 'அம்மா', tanglish: 'Ammmaa', en: 'Ammmaa' };

export const ACTIONS = {
  ta: { done: 'சரி', later: '30 நிமிஷம் கழிச்சு' },
  tanglish: { done: 'Sari', later: '30 nimisham apram' },
  en: { done: 'Okay', later: 'In 30 min' },
};

export const TEST_LINES = {
  ta: 'வணக்கம் கண்ணா! அம்மா இங்க தான் இருக்கேன்.',
  tanglish: 'Vanakkam kanna! Amma inga thaan irukken.',
  en: 'Hello kanna! Amma is right here.',
};

export const MESSAGES = {
  ta: {
    loving: {
      meal: ['சாப்பிட்டியா கண்ணா?', 'நேரம் ஆச்சு, சாப்பிடு டா செல்லம்.'],
      water: ['தண்ணி குடிச்சியா? கொஞ்சம் குடி.', 'ஒரு டம்ளர் தண்ணி குடி கண்ணா.'],
      break: ['கொஞ்சம் கண்ணை மூடி ஓய்வு எடு.', 'ஸ்கிரீனையே பாக்காத, ஒரு பிரேக் எடு.'],
      call: ['எனக்கு ஒரு போன் பண்ணு, உன் குரல் கேக்கணும்.', 'அம்மாகிட்ட பேசி ரொம்ப நாள் ஆச்சு, கூப்பிடு.'],
      bedtime: ['நேரம் ஆச்சு, தூங்கு கண்ணா.', 'போனை வெச்சிட்டு படு, நாளைக்கு பாக்கலாம்.'],
      morning: ['காலை வணக்கம் கண்ணா, சாப்பிட்டு தான் வேலை.', 'எழுந்துட்டியா? நல்ல நாளா அமையட்டும்.'],
    },
    strict: {
      meal: ['சாப்பிடலயா? இப்பவே போய் சாப்பிடு.', 'வேலை நாளைக்கு பாக்கலாம், முதல்ல சாப்பிடு.'],
      water: ['தண்ணி குடிக்கல? இப்பவே குடி.', 'ஒரு டம்ளர் தண்ணி. இப்போ. காத்திருக்காத.'],
      break: ['உக்காந்தே இருக்க, எழுந்து நட.', 'ஸ்கிரீனை மூடு, 5 நிமிஷம் பிரேக்.'],
      call: ['வாரம் ஆச்சு, போன் பண்ணல. இப்பவே கூப்பிடு.', 'போன்ல என்ன பண்ணிட்டு இருக்க? அம்மாவை கூப்பிடு.'],
      bedtime: ['இன்னும் தூங்கலயா? போனை வெச்சிட்டு படு.', 'மணி என்ன தெரியுமா? தூங்கு.'],
      morning: ['எழுந்திரு, முகம் கழுவு, சாப்பிடு.', 'இன்னும் தூங்கிட்டு இருக்கியா? எழுந்திரு.'],
    },
    funny: {
      meal: ['சாப்பிட்டியா? இல்ல வைஃபை மட்டும் தான் சாப்பிடுவியா?', 'வயிறு சொல்லுது: "என்னையும் கவனிக்கலாமே".'],
      water: ['தண்ணி குடி, இல்லன்னா கள்ளிச்செடி மாதிரி ஆயிடுவ.', 'உன் தண்ணி பாட்டிலை நான் பார்த்த மாதிரியே தெரியலயே... குடி!'],
      break: ['நாற்காலியோட கல்யாணம் ஆயிடுச்சு போல. எழுந்து போ!', 'உக்காந்தே இருந்தா நாற்காலிக்கு உன் பேர் வெச்சிடுவாங்க, எழுந்து நட!'],
      call: ['ஒரு போன் பண்ணு, இல்லன்னா "குட் மார்னிங்" படம் அனுப்புவேன்.', 'போன் பண்ணலன்னா வாட்ஸ்அப்ல ஃபார்வர்டு அனுப்புவேன்.'],
      bedtime: ['தூங்கு டா, கனவுல வேலை வராது... பாக்கலாம்.', 'போனை வெச்சிட்டு தூங்கு, ரீல்ஸ் எல்லாம் நாளைக்கும் இருக்கும்.'],
      morning: ['சூரியன் எழுந்துடுச்சு, நீ எப்போ?', 'குட் மார்னிங்! காபி ரெடி, மோட்டிவேஷன் தேடிட்டு இருக்கேன்.'],
    },
  },
  tanglish: {
    loving: {
      meal: ['Saaptiya kanna?', 'Neram aachu, saapdu da chellam.'],
      water: ['Thanni kudichiya? Konjam kudi.', 'Oru glass thanni kudi kanna.'],
      break: ['Konjam kann moodi rest edu.', 'Screen-a paathute irukkaadha, oru break edu.'],
      call: ['Enakku oru call pannu, un kural ketkanum.', 'Ammakitta pesi romba naal aachu, call pannu.'],
      bedtime: ['Neram aachu, thoongu kanna.', 'Phone-a vechutu padu, naalaiku paakalaam.'],
      morning: ['Good morning kanna, saapttu thaan velai.', 'Ezhundhutiya? Nalla naal-a amaiyattum.'],
    },
    strict: {
      meal: ['Saaptiya illaya? Ippove poi saapdu.', 'Velai naalaiku paathukalaam, first saapdu.'],
      water: ['Thanni kudikkala? Ippove kudi.', 'Oru glass thanni. Ippo. Wait pannaadha.'],
      break: ['Ukkaandhe irukka, ezhundhu nada.', 'Screen-a moodu, 5 nimisham break.'],
      call: ['Vaaram aachu, call pannala. Ippove call pannu.', 'Phone-la enna panra? Ammava call pannu.'],
      bedtime: ['Innum thoongalaya? Phone-a vechutu padu.', 'Neram enna theriyumaa? Thoongu.'],
      morning: ['Ezhundhiru, mugam kazhuvu, saapdu.', 'Innum thoongitu irukkiya? Ezhundhiru.'],
    },
    funny: {
      meal: ['Saaptiya? Illa Wi-Fi mattum thaan saapduviya?', 'Vayiru solludhu: "Ennaiyum gavanikkalaame".'],
      water: ['Thanni kudi, illa kalli-chedi maari aayiduva.', 'Un water bottle naan paartha maari theriyalaye... kudi!'],
      break: ['Chair-oda kalyaanam aachu pola. Ezhundhu po!', 'Ukkaandhe irundha chair-ku un peru vechiduvaanga, nada!'],
      call: ['Oru call pannu, illa "Good Morning" image anuppuven.', 'Call pannalana WhatsApp-la forward anuppuven.'],
      bedtime: ['Thoongu da, kanavula velai varaadhu... paakalaam.', 'Phone-a vechutu thoongu, reels ellam naalaikum irukkum.'],
      morning: ['Suriyan ezhundhuduchu, nee eppo?', 'Good morning! Coffee ready, motivation thedittu irukken.'],
    },
  },
  en: {
    loving: {
      meal: ['Have you eaten, kanna?', "It's time to eat something, sweetheart."],
      water: ['Have you had water? Drink a little.', 'One glass of water, sweetheart.'],
      break: ['Close your eyes for a minute and rest.', "Don't stare at the screen so long. Take a break."],
      call: ['Call me, I want to hear your voice.', "It's been a while since we talked. Call home."],
      bedtime: ["It's late, kanna. Go to sleep.", 'Put the phone down. Tomorrow is another day.'],
      morning: ['Good morning, kanna. Eat something before work.', 'Awake? May today be a good one.'],
    },
    strict: {
      meal: ["You haven't eaten? Go eat right now.", 'Work can wait. Eat first.'],
      water: ['No water yet? Drink now.', "One glass of water. Now. Don't wait."],
      break: ["You've been sitting forever. Get up and walk.", 'Close the screen. Five minutes.'],
      call: ["It's been a week and no call. Call home now.", 'What are you doing on that phone? Call your Amma.'],
      bedtime: ['Still awake? Put the phone away.', 'Do you know what time it is? Sleep.'],
      morning: ['Get up, wash your face, eat.', 'Still sleeping? Wake up.'],
    },
    funny: {
      meal: ['Have you eaten? Or do you only feed on Wi-Fi?', "Your stomach says: 'Notice me, please.'"],
      water: ["Drink water, or you'll turn into a cactus.", "Hydrate. I haven't seen that bottle move today."],
      break: ['Looks like you and that chair are married. Get up!', "Sit any longer and they'll name the chair after you. Walk!"],
      call: ["Call me, or I'll forward you a Good Morning image.", "No call? I'll send a WhatsApp forward."],
      bedtime: ["Sleep. Work won't appear in your dreams... probably.", 'Put the phone down. Reels will still be there tomorrow.'],
      morning: ['The sun is already up. And you?', "Good morning! Coffee's ready, motivation is still being searched."],
    },
  },
};

export const DEFAULTS = {
  lang: 'tanglish',
  tone: 'loving',
  quiet: { start: '22:00', end: '07:00' },
  cap: 8,
  reminders: {
    meals: { on: true, breakfast: '08:30', lunch: '13:00', dinner: '20:00' },
    water: { on: true, everyMin: 120, from: '09:00', to: '19:00' },
    breaks: { on: false, everyMin: 90, from: '10:00', to: '18:00' },
    call: { on: false, day: 0, time: '18:00' },
    bedtime: { on: true, time: '22:30' },
    morning: { on: false, time: '07:30' },
  },
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const time = (v, def) => (typeof v === 'string' && HHMM.test(v) ? v : def);
const bool = (v, def) => (typeof v === 'boolean' ? v : def);
const clamp = (v, lo, hi, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : def;
};
const pick = (v, list, def) => (list.includes(v) ? v : def);

// Always returns a complete, safe settings object. Unknown or invalid input falls back to defaults.
export function normalizeSettings(input) {
  const i = input && typeof input === 'object' ? input : {};
  const r = i.reminders && typeof i.reminders === 'object' ? i.reminders : {};
  const D = DEFAULTS.reminders;
  const m = r.meals || {}, w = r.water || {}, b = r.breaks || {}, c = r.call || {}, bt = r.bedtime || {}, mo = r.morning || {};
  const q = i.quiet || {};
  return {
    lang: pick(i.lang, LANGS.map((l) => l.id), DEFAULTS.lang),
    tone: pick(i.tone, TONES.map((t) => t.id), DEFAULTS.tone),
    quiet: { start: time(q.start, DEFAULTS.quiet.start), end: time(q.end, DEFAULTS.quiet.end) },
    cap: clamp(i.cap, 1, 20, DEFAULTS.cap),
    reminders: {
      meals: {
        on: bool(m.on, D.meals.on),
        breakfast: time(m.breakfast, D.meals.breakfast),
        lunch: time(m.lunch, D.meals.lunch),
        dinner: time(m.dinner, D.meals.dinner),
      },
      water: { on: bool(w.on, D.water.on), everyMin: clamp(w.everyMin, 30, 480, D.water.everyMin), from: time(w.from, D.water.from), to: time(w.to, D.water.to) },
      breaks: { on: bool(b.on, D.breaks.on), everyMin: clamp(b.everyMin, 30, 480, D.breaks.everyMin), from: time(b.from, D.breaks.from), to: time(b.to, D.breaks.to) },
      call: { on: bool(c.on, D.call.on), day: clamp(c.day, 0, 6, D.call.day), time: time(c.time, D.call.time) },
      bedtime: { on: bool(bt.on, D.bedtime.on), time: time(bt.time, D.bedtime.time) },
      morning: { on: bool(mo.on, D.morning.on), time: time(mo.time, D.morning.time) },
    },
  };
}

const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const toHHMM = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

function interval(kind, cfg, label) {
  const out = [];
  const from = toMin(cfg.from), to = toMin(cfg.to);
  if (to < from) return out;
  for (let t = from; t <= to; t += cfg.everyMin) out.push({ kind, time: toHHMM(t), dow: null, label });
  return out;
}

// settings -> [{ kind, time:'HH:MM', dow:null|0-6, label }]
export function buildSlots(settings) {
  const s = normalizeSettings(settings);
  const r = s.reminders;
  const slots = [];
  if (r.meals.on) {
    slots.push({ kind: 'meal', time: r.meals.breakfast, dow: null, label: 'Breakfast' });
    slots.push({ kind: 'meal', time: r.meals.lunch, dow: null, label: 'Lunch' });
    slots.push({ kind: 'meal', time: r.meals.dinner, dow: null, label: 'Dinner' });
  }
  if (r.water.on) slots.push(...interval('water', r.water, 'Water'));
  if (r.breaks.on) slots.push(...interval('break', r.breaks, 'Break'));
  if (r.call.on) slots.push({ kind: 'call', time: r.call.time, dow: r.call.day, label: 'Call home' });
  if (r.bedtime.on) slots.push({ kind: 'bedtime', time: r.bedtime.time, dow: null, label: 'Bedtime' });
  if (r.morning.on) slots.push({ kind: 'morning', time: r.morning.time, dow: null, label: 'Good morning' });
  return slots.slice(0, 40);
}

export function pickLine(lang, tone, kind, rand = Math.random) {
  const list = (MESSAGES[lang] && MESSAGES[lang][tone] && MESSAGES[lang][tone][kind]) || MESSAGES.en.loving.meal;
  return list[Math.floor(rand() * list.length)];
}
