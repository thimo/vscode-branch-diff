# Changelog

All notable changes to the Branch Diff extension.

## [Unreleased]

Split out into its own repository. Project scaffolding added (LICENSE,
README, this changelog, RELEASING, F5 launch config).

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
