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

- **Pure JS, no build step.** Same stance as `line-history`: the extension
  is small enough that a toolchain adds more surface than it removes. The
  shipped runtime stays zero-dependency. *Nuance added when the TreeView
  landed:* the one real cost of JS here was the **untyped git extension
  API** (we were hand-reverse-engineering the `Status` const enum). Fixed
  *without* a build: `extension.js` is `// @ts-check`, the official
  `git.d.ts` is vendored, and `@types/vscode` is a **devDependency only**.
  `tsc` never runs — the editor's bundled TS does `checkJs`; the F5 loop
  and `vsce package --no-dependencies` are unchanged and nothing extra
  ships. Don't escalate this to a full TS-with-`tsc` build; that *is* the
  toolchain this constraint rejects.
- **It launches the *native* multi-diff, never a custom renderer.** The
  whole point of escaping Kaleidoscope/Tower/diff2html/GitLens was the
  native editor (native theme, syntax highlighting, rename detection, live
  refresh, editable, no redundant chrome). Don't reintroduce a webview.
- **No `scm/title` button — but a contributed `scm` *view* is fine.**
  These are different mechanisms and the earlier note conflated them. A
  `scm/title` *menu button* does not surface in a multi-view / GitLens-
  heavy Source Control layout (the container `⋯` only shows view toggles;
  even built-in Commit/Refresh collapse away) — don't re-add that. A
  first-class **contributed view** in the `scm` container (`contributes.
  views.scm`, like GitLens' own views) does show, and its **own**
  `view/title` actions (e.g. "Change Base…", "Refresh") live on the view's
  toolbar, not the swallowed container `⋯`. That is where the Branch Diff
  file list lives. Command Palette remains a trigger too.
- **The "PR" framing is dead.** Renamed from `branch-prdiff`: there is no
  pull request, it diffs two refs. Keep the name a name, not a verb
  ("Branch Diff…", not "Branch Diff: Compare against…").

## Key technical facts

- Refs reach the diff via the built-in git API:
  `getExtension('vscode.git').exports.getAPI(1)` → diff → per `Change`,
  `api.toGitUri(uri, ref)`. Branch/commit refs are resolved to SHAs first
  (`repo.getCommit`) so `toGitUri` resolves reliably.
- The diff call is **`repo.diffBetweenWithStats(base, HEAD)`** →
  `DiffChange[]` (`Change` + `insertions`/`deletions`), which is what
  feeds the per-file +/- counts in the view — no `git --numstat`
  child_process needed. It is newer than the `^1.80.0` engines floor, so
  it's feature-detected (`typeof … === "function"`) with a `diffBetween`
  fallback (no counts). Don't assume counts are always present.
- The **absent side of an add/delete must be `undefined`** (API-supported).
  Pointing at a ref where the file does not exist is what produced an empty
  "No Changed Files" editor. Added → no left; deleted → no right; detected
  via the git `Status` const enum (`INDEX_ADDED=1`, `INDEX_DELETED=2`,
  `DELETED=6`).
- The base picker is one `showQuickPick` with two
  `QuickPickItemKind.Separator` sections: branches (local + remote, `main`/
  `master`/`develop` floated to the top) then the last 40 commits on HEAD
  (`repo.log({ maxEntries: 40 })`). Items carry both `ref` and a
  `baseKind: "branch" | "commit"`; `pickBase` returns a `BaseSelection`.
  `matchOnDescription` so typing a short hash filters commits.
- **Commit picks resolve to `commit^` for the diff.** A branch tip is
  used as-is (`branchTip..HEAD` = "since I branched"). For a *commit*,
  using `commit..HEAD` excludes that commit's own changes — counter-
  intuitive when you just clicked it. So `resolveBaseRef` returns
  `commit.parents[0]` for commit picks, making the diff "from this
  commit onwards, inclusive". Root commit (no parent) falls back to the
  commit itself with an info message. Labels (view header, multi-diff
  source URI) keep using the **picked** ref, not the resolved parent —
  the user sees "5da9536d ↔ HEAD", not the parent hash they didn't
  pick.
- A diff needs a baseline: a brand-new untracked file shows nothing until
  there is a commit to diff against (inherent to git, not a bug here).

## File-overview view (built)

The "Branch Diff" view in the Source Control container is the PR-style
file list the native multi-diff lacks. Two render modes, toggled from
the view title bar and persisted in settings:

- **Tree** (default, `branchDiff.viewMode = "tree"`): folder hierarchy,
  expanded by default, theme folder icon per directory. Compact-folder
  collapsing of single-subfolder chains (`a/b/c` as one row) is on by
  default and controlled by `branchDiff.compactFolders`. Mirrors the
  `scm.defaultViewMode` / `scm.compactFolders` pattern from the built-in
  SCM "CHANGES" view — same two knobs, same names under our namespace,
  so the affordance is familiar.
- **List** (`branchDiff.viewMode = "list"`): flat one-row-per-file, with
  the relative dir in the description. Matches the GitHub "Files
  changed" framing.

In both modes, file rows carry a status badge via a themed
`diff-added/-modified/-removed/-renamed` codicon and `+x −y` line counts
when stats are available, sorted by path. Folders show no status badge
or aggregate counts — kept deliberately minimal; add if asked. The view
title bar shows only the *opposite* toggle (via a `config.branchDiff.
viewMode` `when` clause), matching how SCM does it.

`FilesProvider` owns view-mode state and rebuilds a cached tree on
`setComparison` / config change. `showComparison` feeds both the
provider and the native multi-diff (see below). `lastRun` lets the
"Refresh" `view/title` action re-run with the same base (HEAD re-read
in case it moved).

**View header reflects the active comparison.** The view is registered
via `vscode.window.createTreeView` (not `registerTreeDataProvider`) so
we own the `TreeView` handle and can mutate `.description` — this is
what renders dimmed next to "BRANCH DIFF" (e.g. *"main ↔ develop · 66
files"*). Updated from a listener on `onDidChangeTreeData`. The same
switch enables `showCollapseAll: true` (Collapse All button on the view
toolbar — handy in tree mode).

**Editor tab title vs. view description — don't double-count.** The
multi-diff editor automatically appends `(N files)` to whatever `title`
we pass, so `Comparison.title` is just `"base ↔ head"` (no count). The
view description is composed separately *with* a count, since the SCM
view header doesn't auto-append anything.

**Click-to-reveal: built, on an internal command.** A row click reveals
that file *inside* the already-open multi-diff. The mechanism: we open
the editor via `_workbench.openMultiDiffEditor` (not `vscode.changes`)
with a stable `multiDiffSourceUri` (custom `branch-diff://` scheme keyed
on `repoRoot?base=…&head=…`, **no content provider — pure identity**).
Re-invoking the same command with the same source URI focuses that same
editor instead of duplicating it, and accepts a `reveal: { modifiedUri }`
option that scrolls to the row. `openChange` calls it with the node's
`right` URI; deleted files (no `modifiedUri`) and any thrown error fall
back to standalone `vscode.diff`/`vscode.open`, so a click is never
broken.

**The catch — and why it's worth it.** `_workbench.openMultiDiffEditor`
is internal (underscore = no stability guarantee). The public
`vscode.changes` has no `reveal` arg and never will until the multi-diff
API is exposed. The whole purpose of this extension is the PR-sidebar
feel, and reveal *is* that feel — so we eat the stability risk
deliberately. `openOrRevealMultiDiff` already wraps both: tries
`_workbench.openMultiDiffEditor` first, catches and falls back to
`vscode.changes` (without reveal). If the internal command ever
disappears or changes shape, the extension still works — just without
in-editor reveal. **Don't "clean this up" by deleting the fallback.**

Resource shape note: `_workbench.openMultiDiffEditor` takes
`{ originalUri, modifiedUri }[]`, where `vscode.changes` took
`[label, original, modified]` triples. The absent-side-is-`undefined`
rule still applies on both sides (additions/deletions).

## Development

- Press <kbd>F5</kbd> ("Run Extension") for an Extension Development Host
  with the extension loaded from source; edit `extension.js` and reload the
  dev host to iterate. No build, no packaging.
- Sanity-check a change with `node --check extension.js` (parses only;
  `require('vscode')` is not executed). Type errors surface live in the
  editor via `// @ts-check` (no CLI step; `tsc` is intentionally not a
  dependency). `npm install` is needed once for the `@types/vscode`
  devDependency; `node_modules/`, `jsconfig.json`, `package-lock.json`
  and `git.d.ts` are all `.vscodeignore`'d so the `.vsix` stays clean.
- See `RELEASING.md` for packaging and the (not-yet-done) publish steps.
