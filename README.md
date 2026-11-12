# Fitting Room

A private styling studio. The site is static (GitHub Pages); your closet, photos and AI calls live in your own Supabase project.

## How it fits together
- **public/** is the whole website. It signs you in with an emailed link and talks only to Supabase and, for Mirror voice, OpenAI's realtime service.
- **Supabase database:** one table, `records`, holds closet pieces, appearance references, looks and settings. Row-level security limits every row to your account.
- **Supabase storage:** a private `photos` bucket holds your photos at `<your user id>/<photo id>`. Only your signed-in account can read them; the app shows them through links that expire after a week.
- **Supabase function `ai`:** the only place the OpenAI key is used. It accepts requests only from the account in `OWNER_EMAIL`, enforces daily limits in the `usage` table, and runs `supabase/functions/_shared/provider.mjs`.
- **Uploading:** `public/intake.js` uploads photos as soon as they're chosen, a few at a time, and saves each piece the moment its photos are up. New pieces wait in the Closet's Unreviewed section (marked with `intake` on the record) and never reach the stylist until they're added to the closet.
- **Read aloud:** "Why this look" and "Styling & makeup" have a Listen button. The `ai` function's `speak` route makes the audio with OpenAI's `gpt-4o-mini-tts` (`marin` voice) and times each word with `whisper-1`; `public/readaloud.js` highlights the word being spoken. Audio is saved with the look, so replays are free. Daily limit `DAILY_SPEAK_LIMIT` (default 30).
- **Outfit details:** after a render, `public/pose.js` finds the face, neckline and hands on this device with Google's MediaPipe pose model (`public/vendor/mediapipe`, about 25 MB, loaded the first time it's needed). It runs in a sandboxed frame (`pose.html`) and never calls a paid service. Marker positions are saved with the look; `public/details.js` matches pieces and notes to each area.
- **Photos:** JPEG, PNG, WebP, AVIF, GIF and iPhone HEIC. Large photos are resized to 2048 px on the long edge before upload. Safari reads HEIC itself; other browsers convert it in a sandboxed frame (`heic.html`).

## One-time setup
1. **Supabase project.** Create a free project. In the SQL editor, run `supabase/migrations/20261109000000_fitting_room.sql`.
2. **Your account.** Authentication › Users › Add user, with your email. Then Authentication › Sign In / Providers: turn off "Allow new users to sign up".
3. **Sign-in links.** Authentication › URL Configuration: set Site URL to your GitHub Pages address (for example `https://<you>.github.io/Fitting-Room/`) and add it, plus `http://127.0.0.1:4173/`, to Redirect URLs.
4. **AI function.** Deploy `supabase/functions/ai` (with `_shared/provider.mjs`), for example `npx supabase functions deploy ai`. Then Edge Functions › Secrets: add `OPENAI_API_KEY`, `OWNER_EMAIL` (your email) and `ENABLE_PAID_API=true`. Optional settings are listed in `supabase/functions/ai/.env.example`.
5. **Site settings.** Put the project URL and the publishable (anon) key in `public/config.js`. Both are safe to publish. Never put the secret or service_role key there.
6. **GitHub Pages.** Push this folder to a GitHub repository's `main` branch. In the repository: Settings › Pages › Source: GitHub Actions. Each push runs the tests and publishes `public/`.

## Run locally
`npm start`, then open http://127.0.0.1:4173. The local server only serves the site; data and AI still go through Supabase. Run `npm test` for the checks.

## Limits and notes
- Daily caps default to 20 tag requests, 8 selections, 3 images and 3 voice sessions, reset at 00:00 UTC. Attempted paid calls count even if OpenAI fails. These are request limits, not dollar limits.
- Supabase's free plan stops a function after 150 seconds, so image renders time out at 140 seconds (`IMAGE_TIMEOUT_SECONDS`).
- Photos selected for tagging, rendering or Mirror reactions are sent to OpenAI on those actions.
- Mirror's camera and microphone need HTTPS, which GitHub Pages provides, so it works on iPhone. Open sign-in links in the same browser you requested them from.
