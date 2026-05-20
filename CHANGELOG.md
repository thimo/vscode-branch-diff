# Changelog

All notable changes to the Branch Diff extension.

## [0.2.1] — 2026-05-20

- **Icon fills its canvas.** The 0.2.0 icon was drawn iOS-style with a
  100 px inset on every side, which made the Marketplace tile and
  sidebar entry render visibly smaller than other extensions (VS Code
  doesn't mask icons the way iOS does). Cropped the SVG viewBox to the
  visible rect so the rounded square fills the canvas edge-to-edge.

## [0.2.0] — 2026-05-20

First Marketplace release. Since 0.1.0 the extension grew the PR-style
file-list sidebar it was always meant to have, plus the surrounding polish
needed to ship publicly.

- **Files-overview view in the Source Control container.** A contributed
  `scm` view ("Branch Diff") renders the changed-file list next to the
  built-in CHANGES view, with tree/list toggle, click-to-reveal inside the
  open multi-diff editor, per-file `+x −y` line counts, theme-aware status
  badges, and a header description like `main ↔ develop · 66 files`.
- **Tree/list mode persisted in settings** (`branchDiff.viewMode`), plus
  compact-folder collapsing (`branchDiff.compactFolders`) — same two knobs
  as the built-in SCM CHANGES view, mirrored under our namespace.
- **Click-to-reveal inside the open multi-diff editor.** Falls back to a
  standalone diff if the internal `_workbench.openMultiDiffEditor` command
  is unavailable, so a row click is never broken.
- **`+x −y` counts come from `repo.diffBetweenWithStats`** when available
  (feature-detected — newer than the `^1.80.0` engines floor); falls back
  to `diffBetween` (no counts) on older hosts. No `git --numstat`
  child_process.
- **Extension icon** (side-by-side diff panes on a pink/purple gradient)
  + Marketplace metadata (`license`, `repository`, `bugs`, `homepage`,
  `keywords`).
- **Release automation.** `npm run release -- X.Y.Z` runs pre-flight
  (clean tree, parse-check, icon PNG in sync with SVG), bump, tag,
  package, smoke-test pause, marketplace publish, push, GitHub release.

## [0.1.0] — 2026-05-19

Renamed from the prototype `branch-prdiff` (0.0.1). The "PR" framing was
the goal metaphor, not what the tool is — it just diffs two refs into the
native multi-diff editor.

- Renamed: extension id `branch-prdiff` → `branch-diff`, command
  `branchPrdiff.compare` → `branchDiff.open`, palette entry
  **"Branch Diff…"** (no redundant verb).
- **Picker now includes commits.** One QuickPick with two sections —
  other branches (local + remote), then the last 40 commits on the current
  branch — so you can diff HEAD against an earlier commit, not just another
  branch.
- Removed the `scm/title` menu contribution: confirmed never to surface in
  a multi-view / GitLens-heavy Source Control layout. Command Palette is
  the trigger.
- Unchanged core: `diffBetween(picked, HEAD)` → `vscode.changes`; refs
  resolved to SHAs; add/delete/rename via the git `Status` enum; absent
  side `undefined`.

## [0.0.1] — prototype (not in this repository's history)

Current-branch vs. picked-base-branch only, installed as
`thimo.branch-prdiff`. Earlier iteration happened outside this repo.
