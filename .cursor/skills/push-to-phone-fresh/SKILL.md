---
name: push-to-phone-fresh
description: Rebuild and re-serve Random Game for the phone, clearing local site data first so the phone loads a clean copy. Use only when the user explicitly asks for a fresh install, a clean install, to wipe and reinstall, or to reset the phone's app data before installing. Do NOT use for routine "push to phone" requests — use push-to-phone for those.
disable-model-invocation: true
---

# Push to phone (fresh, wipes browser site data)

This project is a Vite + React **web** app. A "fresh install" means a new
production build plus telling the user to clear that origin's site data on the
phone (localStorage / caches), then reload.

## Desktop only

This skill needs the local machine's network and a running preview server. It
cannot run usefully on Cursor Cloud / web agents.

## When to use this vs push-to-phone

- Default for "push/install/update the app on my phone" → use `push-to-phone`.
  Do NOT use this skill unless the user explicitly asks for a wipe/fresh/clean
  install, or to reset phone data before loading.
- Also use this if a stale service worker / cached bundle is serving old code
  and the user has confirmed they want a wipe.

## Steps

Run from the project root
(`c:\Users\joeal\Documents\Development\Apps\RandomGame`).

1. **Warn and confirm before wiping**, unless the user has already explicitly
   confirmed the wipe in this same request. State plainly that clearing site
   data on the phone will erase any in-browser game state stored for that URL,
   and ask them to confirm before proceeding.

2. **Build** a fresh production bundle:
   ```
   npm run build
   ```

3. **Serve on the LAN:**
   ```
   npx vite preview --host --port 4173
   ```
   If a preview/dev server is already running, restart it so it picks up the
   new `dist/` output.

4. **Tell the user how to load cleanly** on the phone: open the site, clear
   site data / cached files for that origin, then reload the Network URL (not
   `localhost`).

5. **Confirm** the Network URL and that this is a clean load.

## Never do

- ❌ `adb uninstall` / `adb install` / `flutter install` — this is not an
  Android package.
- ❌ `git add` / `git commit` / `git push` — this skill only rebuilds and
  serves. The user commits manually; never create a commit as a side effect of
  pushing to the phone, even if there are staged or uncommitted changes. If the
  user separately wants a commit, they'll ask (see the
  [`commit`](../commit/SKILL.md) skill).
