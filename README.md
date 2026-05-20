# Branch Diff

[![Release](https://img.shields.io/github/v/release/thimo/vscode-branch-diff?label=release)](https://github.com/thimo/vscode-branch-diff/releases) [![VS Code Marketplace](https://img.shields.io/badge/marketplace-install-blue)](https://marketplace.visualstudio.com/items?itemName=thimo.branchdiff)

The GitHub **"Files changed"** tab, locally. All changes between the
current branch (HEAD) and another branch — or an earlier commit on the
current branch — stacked in VS Code's native multi-file diff editor,
with a PR-style sidebar of changed files. No GitHub, no leaving the
editor.

## What it does

- **Command Palette: _Branch Diff…_** → one picker listing every other
  branch (local + remote) and the last 40 commits on the current
  branch.
- **Pick a branch** → diffs HEAD against that branch tip
  (`branch..HEAD`, "what I've added on top").
- **Pick a commit** → diffs from that commit onwards, **inclusive of
  its own changes**, up to HEAD. (Internally `commit^..HEAD`, so the
  changes _in_ the commit you just clicked are part of the diff —
  which is what you'd expect.)
- The result opens stacked in the native multi-diff editor: every
  changed file in one scrollable view, syntax-highlighted, rename-
  detected, native theme, live refresh as files change. Ideal for
  watching agent edits land.

## The file-list sidebar

A **Branch Diff** view appears in the **Source Control** panel with
every changed file in the active comparison:

- **Tree** or **flat list** layout — toggled from the view title bar
  (button on the left), persisted in settings.
- Compact-folder collapsing in tree mode (`a/b/c` joined into one row
  when intermediate folders only contain one subfolder — same idea as
  the built-in SCM "CHANGES" view).
- Per-file `+x −y` line counts (via the git API, no shelling out) and
  themed add/modify/delete/rename status icons.
- **Click a file → reveals that file _inside_ the already-open
  multi-diff editor**, scrolling to it instead of opening a separate
  tab. Deleted files (no head-side content to reveal) open as a
  standalone diff alongside.
- **Change Base…** and **Refresh** actions on the view toolbar — swap
  to a different base or re-run with the current one (HEAD is re-read
  each time, so refresh picks up new commits).
- The view header reflects the active comparison next to
  "BRANCH DIFF" — e.g. *"main ↔ develop · 66 files"*.

## Relation to the native multi-diff editor

VS Code already opens a native multi-diff for the working tree, staged
changes, or a commit range selected in the Source Control Graph. Branch
Diff adds the one entry point that isn't built in: an ad-hoc
**current-branch vs. arbitrary branch-or-commit** comparison from a
single command — without hunting through the Graph or staging anything.
Same native editor, with the missing PR-style sidebar bolted on.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `branchDiff.viewMode` | `"tree"` | How the file list renders. `"tree"` or `"list"`. |
| `branchDiff.compactFolders` | `true` | In tree mode, collapse chains of single-subfolder folders into one row. |

## Development

No build step, zero runtime dependencies. The only devDependency is
`@types/vscode` for editor-level `// @ts-check` against the official
VS Code typings (nothing compiled — the editor's bundled TS checks the
JS in place). After `npm install`, press <kbd>F5</kbd> ("Run
Extension") to launch an Extension Development Host with the extension
loaded; edit `extension.js` and reload the dev host to iterate. See
`RELEASING.md` for packaging.

## License

MIT © Thimo Jansen
