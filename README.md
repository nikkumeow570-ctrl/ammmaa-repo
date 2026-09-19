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
public/    PWA: index.html, app.js, sw.js, shared.js (message bank + settings), icons
src/       Worker: index.js (API), cron.js (sender), push.js (Web Push), ai.js, time.js, auth.js
test/      node:test suites (no network needed)
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

## Configuration
| Name | Kind | Purpose |
|---|---|---|
| `VAPID_PUBLIC_KEY` | var | Public Web Push key, served to the app |
| `VAPID_SUBJECT` | var | `mailto:` contact for push services |
| `AI_VARIATIONS` | var | `"on"` lets Workers AI add daily message variations |
| `AI_MODEL` | var (optional) | Override the default model in `src/ai.js` |
| `VAPID_PRIVATE_KEY` | secret | Signs push requests |
| `APP_SECRET` | secret | Signs the snooze buttons in notifications |

## Tests
`npm test` (Node 22+). CI runs it on every push. The suite does not depend on the time of day.

## Notes
- The Tamil and Tanglish lines in `public/shared.js` were written by an AI. Have a native speaker read every line before launch.
- Privacy: no accounts; the server stores only a push subscription, a timezone, your settings and your schedule.
- Web apps cannot read your calendar or app usage, and cannot make home-screen widgets. Those need a native app.
