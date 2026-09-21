# Android app (Trusted Web Activity)

A Trusted Web Activity (TWA) is a thin Android shell that opens the live Anbudan Amma site full screen, with no browser bar. Notifications still come from the web app's Web Push, so nothing changes in how reminders work.

**Because it loads the live site, web changes reach the Android app immediately.** You only rebuild the Android package to change its name, icon, colours, version or package ID.

## What lives in this repo, and what does not
| In the repo | Not in the repo (keep it private) |
|---|---|
| `public/manifest.webmanifest` (name, icons, colours, shortcuts) | `signing.keystore` and `signing-key-info.txt` |
| `public/twa/assetlinks.json`, served at `/.well-known/assetlinks.json` | Built `.apk` / `.aab` files (attach them to a GitHub Release instead) |
| `scripts/make-assetlinks.mjs`, which writes and checks that file | The generated Android project, unless you decide to keep it |
| This page | |

`.gitignore` already blocks `*.keystore`, `*.jks`, `signing-key-info.txt`, `*.apk` and `*.aab`.

**Losing the signing key means you can no longer update the app under the same identity.** Keep `signing.keystore` and `signing-key-info.txt` in two private places (for example a password manager and an encrypted backup).

## Fill this in once the app is built
| | |
|---|---|
| Package ID | `com.yourname.anbudanamma` (cannot be changed later on Google Play) |
| App name | Anbudan Amma |
| Version name / code | 1.0.0 / 1 (raise the code for every upload) |
| Site URL used to build | `https://<your-site>` (the exact final address) |
| Where the signing key is kept | |

## Build it from a phone with PWABuilder
1. Deploy the site and check that the app installs and notifications work in Chrome.
2. Open **pwabuilder.com** (use "Desktop site" in your browser if the page is cramped) and enter your site's exact address. Use the final address: if your site redirects to another address, the link check fails and the browser bar shows.
3. Choose **Package for stores, Android**. Set the package ID, app name and version. Let PWABuilder create a new signing key.
4. Download the zip. It contains the app files, `signing.keystore`, `signing-key-info.txt` and an `assetlinks.json`. Put the two key files somewhere private right away.
5. **Link the site to the app.** Take the SHA-256 fingerprint from `signing-key-info.txt` (or from the `assetlinks.json` in the zip), then in the repo:
   ```
   node scripts/make-assetlinks.mjs com.yourname.anbudanamma "AA:BB:CC:...:FF"
   node scripts/make-assetlinks.mjs --check
   git add public/twa && git commit -m "Link the Android app" && git push
   ```
   When the build is green, open `https://<your-site>/.well-known/assetlinks.json`. It should show your package name and fingerprint.
6. Install the APK on your phone (allow installs from unknown sources). The app should open without a browser bar. Turn on notifications inside the app and send a test message.

## Publishing on Google Play
- You need a Google Play Console developer account (a one-time fee; check the current amount). New accounts have had extra requirements, such as a closed test with a minimum number of testers for a minimum number of days. Read Google's current rules before planning a launch date.
- Upload the `.aab` file, not the APK. With Play App Signing, Google re-signs the app with its own key, so the fingerprint people's phones see is Google's. Copy it from Play Console (Setup, App integrity) and add it next to your own:
  ```
  node scripts/make-assetlinks.mjs com.yourname.anbudanamma "<your upload key fingerprint>" "<Play app signing fingerprint>"
  ```
- Use `https://<your-site>/privacy.html` as the privacy policy address, after adding a contact email to it. Chat text goes to an AI service, so mention that in the store's data-safety answers.
- Before a public release, replace the prototype voice clips with a licensed voice and have a native speaker review the Tamil text.

## If something is wrong
| Symptom | Likely cause |
|---|---|
| A browser bar shows at the top of the app | The fingerprint in `assetlinks.json` is not the one that signed the installed app (with Play App Signing, add Google's), the package name differs, or the site address redirects. After fixing, clear the browser's data for your site, because Chrome caches the link file |
| The link file shows "Not found" | `public/twa/assetlinks.json` is missing or the build failed. The Worker serves it at `/.well-known/assetlinks.json` |
| No reminders arrive in the Android app | Check notification permission for the app and for Chrome in Android settings, then use More, "Check my reminders" |
| `--check` says "no Android app is linked yet" | The file still holds the empty placeholder. Run the first command above |

## Not set up (yet)
Building the Android package automatically in GitHub Actions. Because the app rarely needs rebuilding, PWABuilder is enough for now.
