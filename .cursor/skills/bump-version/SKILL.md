---
name: bump-version
description: Bump the Foresee version everywhere it is written, keeping the sources in sync. Use whenever asked to bump/increment/raise the version, cut a new version, or set a specific version. Default bump is +0.0.1 unless the user states otherwise.
disable-model-invocation: true
---

# Bump app version (keep every copy in sync)

The version is authored in `package.json`, which is currently the **only** live
copy in this project. Grep anyway before editing — copies tend to appear over
time (an about/settings screen, a README badge).

## Version format

`package.json` holds it as `"version": "<name>"`, e.g. `0.0.1`:

- **`<name>`** — human-facing semver (three dot-separated numbers).

There is no separate Android-style build number in this web app.

## Default bump

Unless the user specifies a different target, bump by **`+0.0.1` on the name**:

- `0.0.1` → `0.0.2`
- `0.0.9` → `0.0.10` (each name segment is an independent integer — `9`
  goes to `10`, it does **not** carry into the middle segment)

If the user names an explicit version (e.g. "bump to 0.1.0", "make it 1.0.0"),
use exactly that.

## Steps

Work from the project root
(`c:\Users\joeal\Documents\Development\Apps\RandomGame`).

1. **Read the current version** from `package.json` (`"version"` field).
2. **Compute the target** — apply the default bump, or the user's explicit value.
3. **Grep** for the old version name to find any other live copy:

   ```
   rg -n "0\.0\.\d+" --glob '*.md' --glob 'package.json' --glob 'src/**/*.{ts,tsx}'
   ```

   Only treat a hit as a live copy if it really is the app's current version.
   Ignore illustrative version numbers in docs and unrelated package version
   constraints in `package.json`'s dependency list.
4. **Edit** `package.json` (and any other confirmed live copy) to the new
   version, respecting each file's format.
5. **Report** the old → new version and the list of files changed.

## Do not

- ❌ Don't touch the dependency version constraints in `package.json`
  (`react: ^19.1.0` and friends) — those are unrelated to the app version.
- ❌ Don't edit `package-lock.json` by hand unless a bump tool already changed it.
- ❌ Don't run a build or `npm install` unless the user asks; a version bump
  is a text change.
- ❌ Don't `git add`, `git commit`, or `git push` the bump on your own — this
  skill only edits version text. Committing is a separate, explicit ask (see
  the [`commit`](../commit/SKILL.md) skill), except when this skill is being
  run *as a step inside* the `commit` skill itself.
