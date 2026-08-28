---
name: commit
description: Bump the app version, then commit the currently staged changes with a clear, conventional message, then push, open a PR, and wait until GitHub Pages is serving that version. Use whenever asked to commit staged changes, "commit what's staged", or "make a commit". Only commits what is already staged (plus the version bump) — it does not stage other new files unless the user asks.
disable-model-invocation: true
---

# Commit staged changes (with a version bump), then push

Bump the app version and then create a single commit from the changes that are
**already staged**, then push the branch, open a PR, and wait until GitHub Pages
is serving that version. Do not stage other files unless the user explicitly
asks — the point of this skill is to commit the user's chosen staged set (plus
the version bump this skill makes), not everything in the working tree.

## ⚠️ Never run this proactively

The user commits manually and does **not** want the agent creating commits (or
pushing) on its own initiative. Only run this skill when the user's **current**
message explicitly asks for a commit/push (e.g. "commit this", "commit what's
staged", "push this up"). Never chain into it automatically:

- Finishing a feature, fix, or edit is **not** a reason to commit — stop and
  hand control back to the user instead.
- Other skills (`bump-version`, `push-to-phone`, `push-to-phone-fresh`, etc.)
  finishing is **not** a reason to commit, even if changes happen to be staged.
- A prior turn in the same conversation asking to commit does **not** carry
  forward — a new commit needs a new, explicit ask.

If you're unsure whether the user is asking for a commit right now, ask them
rather than assuming.

## Steps

0. **Use a fresh branch off latest `master`/`main`.** Before committing, make
   sure the work sits on a branch that can still become a new PR — not a branch
   whose PR already merged, and not bare `master`/`main`. If there is no git
   repo yet, stop and tell the user rather than initializing one unasked.

   ```
   git fetch origin
   git branch --show-current
   gh pr list --head "$(git branch --show-current)" --state merged --json number --jq '.[0].number // empty'
   ```

   - If the current branch is `master`/`main`, **or** `gh` reports a merged PR
     for this head, **or** the branch tip is already contained in
     `origin/master` (or `origin/main`) while you still have new staged work:
     create a new branch from updated default branch **without losing the
     staged set**:

     ```
     git stash push --staged -m "commit-skill staged"
     git checkout -B cursor/<short-topic> origin/master
     git stash pop
     ```

     Pick a short topic slug from the change (e.g. `cursor/fix-lobby`).
     Re-stage anything that came back unstaged from the stash pop. Use
     `origin/main` if that is the default branch.
   - Never push follow-up commits onto a branch after its PR has merged
     (squash-merge leaves that tip off the default branch; further pushes look
     “unmerged” forever and braid the graph).
   - If already on a good unmerged feature branch based on recent default
     branch, continue on it.

1. **Inspect what is staged.** Run these together to understand the change:

   ```
   git status
   git diff --staged
   ```

   - If **nothing is staged**, stop and tell the user — do not run `git add`
     on your own. Ask whether they want to stage everything or a subset.
   - Note any unstaged changes so you can mention them in the report (they will
     be left out of the commit).

2. **Bump the version.** Run the [`bump-version`](../bump-version/SKILL.md) skill
   to increment the version everywhere it is authored (default `+0.0.1` unless
   the user asked for a specific version). Then **stage the files that bump
   changed** so they land in this commit:

   ```
   git add package.json
   ```

   (Stage exactly the files `bump-version` reported as changed — no others.) This
   is the one intentional exception to the "only commit what's staged" rule: the
   version bump belongs with the commit it ships.

3. **Review recent history** for message style so the new commit matches:

   ```
   git log --oneline -10
   ```

   Read a few recent messages to keep the voice consistent, then use the
   template below.

4. **Write the message.** Use this template:

   - **Subject:** `v<name> - <short imperative summary>` where `<name>` is the
     new version from the bump (e.g. `v0.0.2`). Use a plain ASCII hyphen
     (`-`, U+002D) between the version and summary — **not** an en-dash (`–`);
     Windows shells often mangle Unicode dashes into `?` in commit subjects.
     Keep the summary concise (imperative mood, no trailing period), describing
     the theme of the change.
   - **Body:** a bullet list of what changed. Lead with the version-bump bullet,
     then one bullet per meaningful change:

     ```
     - Bump version to <name>
     - <change 1>
     - <change 2>
     ```

   Do **not** add `Co-Authored-By`, `Signed-off-by`, or any other model/vendor
   trailer.

5. **Commit.** Prefer a HEREDOC on bash. On PowerShell, pipe a here-string into
   `git commit -F -`:

   ```
   # bash
   git commit -m "$(cat <<'EOF'
   v<name> - <short imperative summary>

   - Bump version to <name>
   - <change 1>
   - <change 2>
   EOF
   )"
   ```

   ```
   # PowerShell
   @'
   v<name> - <short imperative summary>

   - Bump version to <name>
   - <change 1>
   - <change 2>
   '@ | git commit -F -
   ```

6. **Confirm the commit.** Run `git status` and note the new commit's hash,
   subject, and the old → new version. If a pre-commit hook modified files or
   the commit failed, surface that plainly and do not retry blindly — and do
   not push a failed/incomplete commit.

7. **Push.** Sync the commit to its remote if one exists:

   ```
   git push -u origin HEAD
   ```

   Use `-u` when the branch is new (the usual case after step 0). If the push
   is rejected (e.g. non-fast-forward), stop and tell the user rather than
   force-pushing. If there is no remote yet, report that the commit is local
   only.

8. **Check CI** if `.github/workflows` exists. Before pushing you can catch
   failures locally:

   ```
   npm run build
   ```

   If the build fails, say so plainly and don't paper over it.

9. **Open a PR and ship to GitHub Pages.** A `/commit` is not done until the
   site on GitHub Pages is serving this version. This repo squash-merges PRs
   after CI (`.github/workflows/automerge.yml`) and then deploys
   (`.github/workflows/deploy.yml`). After a successful push:

   ```
   gh pr list --head "$(git branch --show-current)" --state open --json number --jq '.[0].number // empty'
   ```

   - If there is no open PR, create one with `gh pr create` (title = commit
     subject, body = the commit bullets). Do not wait for the user to ask.
   - Watch CI until it succeeds (`gh run watch` on the PR's CI run).
   - Automerge should squash-merge to `main` and trigger Pages. Confirm the
     PR is merged (`gh pr view --json state,mergedAt`) and that
     **Deploy to GitHub Pages** on `main` has completed.
   - If automerge did not fire, squash-merge the PR (`gh pr merge --squash`)
     and, if deploy still does not start, `gh workflow run "Deploy to GitHub Pages" --ref main`.
   - Report the live Pages URL (typically
     `https://baganovski.github.io/Eggs/`) so the user can click through.

10. **Report.** Give the commit hash, subject, old → new version, PR URL,
    confirm the push and Pages deploy succeeded (or explain why they didn't),
    and note the CI status.

## Do not

- ❌ Don't `git add` unstaged or untracked files unless the user asks — commit
  only what is already staged, plus the version-bump files from step 2.
- ❌ Don't force-push, or push if the commit step failed.
- ❌ Don't amend an existing commit; create a new one unless the user asks to amend.
- ❌ Don't pass `--no-verify` or otherwise skip hooks. If a hook fails, fix the
  underlying issue or report it.
- ❌ Don't commit `node_modules/`, `dist/`, or editor/log junk — they aren't
  part of the source.
