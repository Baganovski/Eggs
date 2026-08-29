---
name: push-to-phone
description: >-
  Serve the latest Eggs build so it can be opened on a phone on the same
  network WITHOUT wiping anything. Default for push/install/deploy requests.
  Use when asked to push, install, or deploy a new version to the phone, update
  the app on the device, or "get this onto my phone" — unless the user
  explicitly asks for a fresh/clean install, in which case use
  push-to-phone-fresh instead.
---

# Push to phone (data-preserving)

This project is a Vite + React **web** app, not a Flutter/Android APK. There is
no `adb install` path. "Push to phone" means build (if needed) and serve so the
user can open the game in the phone browser.

## Desktop only

This skill needs the local machine's network and a running preview server. It
cannot run usefully on Cursor Cloud / web agents.

## Steps

Work from the **repo root** (the directory that contains `package.json`).

1. **Build** so the phone gets current code:
   ```
   npm run build
   ```

2. **Serve on the LAN** so the phone can reach it. Prefer Vite preview bound to
   all interfaces:
   ```
   npx vite preview --host --port 4173
   ```
   If a preview/dev server is already running on the LAN, reuse it instead of
   starting a second one.

3. **Report the URL.** Give the user the Network URL from the preview output
   (not `localhost` — that only works on the PC). They open that URL on the
   phone.

4. **Confirm.** If the server failed to bind or no Network URL appeared, say so
   plainly (firewall / Wi-Fi mismatch are the usual causes).

## Never do

- ❌ `adb uninstall`, `adb install`, or `flutter install` — this is not an
  Android package.
- ❌ `git add` / `git commit` / `git push` — this skill only builds and serves.
  The user commits manually; never create a commit as a side effect of pushing
  to the phone, even if there are staged or uncommitted changes. If the user
  separately wants a commit, they'll ask (see the
  [`commit`](../commit/SKILL.md) skill).
