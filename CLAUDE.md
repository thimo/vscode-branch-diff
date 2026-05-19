# branch-diff — architecture notes

A VS Code extension: an ad-hoc **current-branch vs. another branch-or-commit**
comparison opened in the native multi-file diff editor — the GitHub
"Files changed" tab, locally. The sibling of `line-history` (next door):
two small, orthogonal git tools, deliberately kept separate rather than one
GitLens-style umbrella.

These notes explain the non-obvious decisions so contributors don't have to
rediscover them. Not shipped in the `.vsix`.

## Goal

The native multi-diff editor is the answer for *watching changes* — but
VS Code only opens it for the working tree, staged changes, or a commit
range hand-selected in the Source Control Graph. The missing entry point is
"diff HEAD against an arbitrary branch or earlier commit, now, from one
command". That gap — and only that gap — is what this fills.

## Design constraints

- **Pure JS, zero dependencies, no build step.** Same stance as
  `line-history`: the extension is small enough that a toolchain adds more
  surface than it removes.
- **It launches the *native* multi-diff, never a custom renderer.** The
  whole point of escaping Kaleidoscope/Tower/diff2html/GitLens was the
  native editor (native theme, syntax highlighting, rename detection, live
  refresh, editable, no redundant chrome). Don't reintroduce a webview.
- **No `scm/title` button.** It does not surface in a multi-view /
  GitLens-heavy Source Control layout (the container `⋯` only shows view
  toggles; even built-in Commit/Refresh collapse away). Command Palette is
  the trigger. Don't re-add the menu contribution expecting it to show.
- **The "PR" framing is dead.** Renamed from `branch-prdiff`: there is no
  pull request, it diffs two refs. Keep the name a name, not a verb
  ("Branch Diff…", not "Branch Diff: Compare against…").

## Key technical facts

- Refs reach the diff via the built-in git API:
  `getExtension('vscode.git').exports.getAPI(1)` → `repo.diffBetween(base,
  HEAD)` → per `Change`, `api.toGitUri(uri, ref)`. Branch/commit refs are
  resolved to SHAs first (`repo.getCommit`) so `toGitUri` resolves
  reliably.
- The **absent side of an add/delete must be `undefined`** (API-supported).
  Pointing at a ref where the file does not exist is what produced an empty
  "No Changed Files" editor. Added → no left; deleted → no right; detected
  via the git `Status` const enum (`INDEX_ADDED=1`, `INDEX_DELETED=2`,
  `DELETED=6`).
- The base picker is one `showQuickPick` with two
  `QuickPickItemKind.Separator` sections: branches (local + remote, `main`/
  `master`/`develop` floated to the top) then the last 40 commits on HEAD
  (`repo.log({ maxEntries: 40 })`). The selected item carries a `ref`
  string; `diffBetween(ref, HEAD)` does the rest. `matchOnDescription` so
  typing a short hash filters commits.
- A diff needs a baseline: a brand-new untracked file shows nothing until
  there is a commit to diff against (inherent to git, not a bug here).

## Known gap (candidate next build)

Ad-hoc branch comparisons don't appear in the Source Control "Changes"
group and the native multi-diff has no file-list / jump-tree like GitHub's
PR sidebar — with many files you scroll blind. The candidate fix is a
contributed file-overview `TreeView` (per-file +/- counts, add/mod/del/
rename badges, click-to-reveal in the open multi-diff via
`multiDiffSourceUri`). Not built. This is the single biggest UX gap vs a
real PR view; do this before anything else.

## Development

- Press <kbd>F5</kbd> ("Run Extension") for an Extension Development Host
  with the extension loaded from source; edit `extension.js` and reload the
  dev host to iterate. No build, no packaging.
- Sanity-check a change with `node --check extension.js` (parses only;
  `require('vscode')` is not executed).
- See `RELEASING.md` for packaging and the (not-yet-done) publish steps.
