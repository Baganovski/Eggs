---
name: bump-version
description: >-
  Bump the Eggs app version everywhere it is written, keeping package.json and
  package-lock.json in sync. Use when asked to bump, increment, raise, or set
  the version. Default bump is +0.0.1 unless the user states otherwise.
---

# Bump app version (keep every copy in sync)

The version is authored in `package.json`. `vite.config.ts` reads that field
and injects `__APP_VERSION__` — do not hardcode a second copy there. Grep
anyway before editing — copies tend to appear over time (an about/settings
screen, a README badge).

## Version format

`package.json` holds it as `"version": "<name>"`, e.g. `0.0.12`:

- **`<name>`** — human-facing semver (three dot-separated numbers).

There is no separate Android-style build number in this web app.

## Default bump

Unless the user specifies a different target, bump by **`+0.0.1` on the name**:

- `0.0.1` → `0.0.2`
- `0.0.9` → `0.0.10` (each name segment is an independent integer — `9`
  goes to `10`, it does **not** carry into the middle segment)
- `0.0.12` → `0.0.13`
- `0.1.0` is only used when the user asks for it

If the user names an explicit version (e.g. "bump to 0.1.0", "make it 1.0.0"),
use exactly that.

## Steps

Work from the **repo root** (the directory that contains `package.json`).

1. **Read the current version** from `package.json` (`"version"` field).
2. **Compute the target** — apply the default bump, or the user's explicit value.
3. **Grep** for the **actual old version string** (not a `0.0.x` wildcard):

   ```
   rg -n "<escaped-old-version>" --glob 'package.json' --glob 'package-lock.json' --glob '*.md' --glob 'src/**/*.{ts,tsx}'
   ```

   Escape dots in the version (`0.0.12` → `0\.0\.12`). Only treat a hit as a
   live copy if it really is the app's current version. Ignore illustrative
   numbers in docs and unrelated package version constraints in
   `package.json`'s dependency list.
4. **Edit** `package.json` (and any other confirmed live copy) to the new
   version, respecting each file's format.
5. **Refresh the lockfile name** so it matches `package.json`:

   ```
   npm install --package-lock-only
   ```

   Do not edit `package-lock.json` by hand. Do not run a full `npm install` or
   a build unless the user asks — this is only to sync the root `"version"`
   field.
6. **Report** the old → new version and the list of files changed
   (typically `package.json` and `package-lock.json`).

## Do not

- ❌ Don't touch the dependency version constraints in `package.json`
  (`react: ^19.1.0` and friends) — those are unrelated to the app version.
- ❌ Don't `git add`, `git commit`, or `git push` the bump on your own — this
  skill only edits version text. Committing is a separate, explicit ask (see
  the [`commit`](../commit/SKILL.md) skill), except when this skill is being
  run *as a step inside* the `commit` skill itself.
