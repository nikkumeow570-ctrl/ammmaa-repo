# Ammmaa

Gentle "have you eaten?" reminders from an Amma-style character, in Tamil, Tanglish or English.
A PWA on Cloudflare: static assets + one Worker + D1, with Web Push notifications. No accounts.

## How it works
- The app (`public/`) lets you pick language, tone (loving / strict / funny), reminders, quiet hours and a daily cap.
- The Worker (`src/`) stores your push subscription and schedule in D1 and sends due reminders every minute (cron).
- Reminders that are more than 10 minutes late are dropped, never queued. Quiet hours and the daily cap are respected.
- Optional: Workers AI writes fresh message variations once a day (`AI_VARIATIONS`, off by default).

## Layout
```
public/    PWA: index.html, app.js (screens), style.css, sw.js, shared.js (message bank + settings),
           amma.js (the cartoon Amma, 4 moods, inline SVG), chat.js, voice.js, own.js, privacy.html, voice/ (clips), icons/
src/       Worker: index.js (API), cron.js (sender), push.js (Web Push), ai.js, time.js, auth.js
test/      node:test suites (no network needed)
scripts/   gen-vapid.mjs (push keys), make-icons.py (renders the app icons from amma.js), make-voice.mjs (voice clips)
schema.sql D1 schema        wrangler.jsonc  Worker config
```

## Deploy without Wrangler on your machine (works from a phone)
1. `node scripts/gen-vapid.mjs` and keep both keys.
2. Cloudflare dashboard: create a D1 database named `ammmaa`, run `schema.sql` in its Console, copy the database ID.
3. Edit `wrangler.jsonc`: set `database_id`, `VAPID_PUBLIC_KEY` and `VAPID_SUBJECT` (mailto: address).
4. Push this repo to GitHub. In Cloudflare: Workers & Pages, Create, Import a repository. It builds and deploys on every push.
5. Worker Settings, Variables and Secrets: add secrets `VAPID_PRIVATE_KEY` and `APP_SECRET` (any long random string).
6. Open the Worker URL on your phone, finish setup, allow notifications, tap "Ping me now". On iPhone, use Add to Home Screen first.

## Deploy with the Wrangler CLI (desktop, Codespaces, proot Ubuntu)
```
npm install
npx wrangler login
npm run db:create      # paste the database_id into wrangler.jsonc
npm run db:init
npm run keys           # paste the public key into wrangler.jsonc
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put APP_SECRET
npm run deploy
```
Wrangler does not install natively in Termux (native dependencies), so use the first route there.

## Look and feel
Amma is drawn in `public/amma.js` and changes mood with the tone the person picks (loving, strict, funny) and falls asleep on bedtime lines.
After editing her, regenerate the icons: `pip install playwright && playwright install chromium && python3 scripts/make-icons.py`.
The service worker cache name (`CACHE` in `public/sw.js`) must be bumped whenever the UI files change, or installed apps keep the old look.

## Configuration
| Name | Kind | Purpose |
|---|---|---|
| `VAPID_PUBLIC_KEY` | var | Public Web Push key, served to the app |
| `VAPID_SUBJECT` | var | `mailto:` contact for push services |
| `AI_VARIATIONS` | var | `"on"` lets Workers AI add daily message variations |
| `AI_MODEL` | var (optional) | Override the default model in `src/ai.js` |
| `CHAT_PROVIDER` | var (optional) | `workers-ai` (default), `groq` or `sarvam`. Workers AI is always the backup |
| `CHAT_DAILY` | var (optional) | Chat messages allowed per phone per day (default 12) |
| `GROQ_API_KEY` / `GROQ_MODEL` | secret / var | Only for `groq` (default model `llama-3.3-70b-versatile`) |
| `SARVAM_API_KEY` / `SARVAM_MODEL` | secret / var | Only for `sarvam` (default model `sarvam-30b`; the request format has not been tested against the live service) |
| `VAPID_PRIVATE_KEY` | secret | Signs push requests |
| `APP_SECRET` | secret | Signs the snooze buttons in notifications |

## Chat, voice and "Your own Amma"
- **Chat** (`src/chat.js`, `public/chat.js`): a short chat with Amma. The reply comes from the provider above. Serious messages (English, Tanglish, Tamil) get a fixed caring reply that mentions India's Tele-MANAS helpline (14416) and never reach the AI. After the daily limit, or if the AI fails, Amma answers from her ready-made lines. Set a provider's key with `wrangler secret put` or the dashboard, never in the repo.
- **Voice clips** (`scripts/make-voice.mjs`): makes an MP3 for every ready-made line and writes `public/voice/manifest.json`. Needs the `edge-tts` command (`pip install edge-tts`).
  ```
  node scripts/make-voice.mjs --dry        # plan and character count, makes nothing
  node scripts/make-voice.mjs              # safe to re-run: finished clips are skipped
  TANGLISH_FROM=ta node scripts/make-voice.mjs --lang=tanglish   # optional: Tamil voice for the Tanglish lines
  ```
  Commit `public/voice/`. Without clips, the speaker button falls back to the phone's own voice, and is hidden if the phone has none.
  `edge-tts` is an unofficial client of Microsoft's Edge read-aloud service. Treat the clips as a prototype and replace them with a licensed voice before a public launch.
- **Your own Amma** (`public/own.js`, `public/voice.js`): a photo and short voice recordings that stay on the phone (browser storage), never uploaded. Her recording plays first, then the pre-made clip, then the phone's voice.
- **Privacy** (`public/privacy.html`): add a contact email before sharing the app publicly.

## Tests
`npm test` (Node 22+). CI runs it on every push. The suite does not depend on the time of day.

## Notes
- The Tamil and Tanglish lines in `public/shared.js` were written by an AI. Have a native speaker read every line before launch.
- Privacy: no accounts; the server stores only a push subscription, a timezone, your settings and your schedule.
- Web apps cannot read your calendar or app usage, and cannot make home-screen widgets. Those need a native app.
