# Branch Diff

The GitHub **"Files changed"** tab, locally. All changes between the current
branch (HEAD) and another branch — or an earlier commit on the current
branch — stacked in VS Code's native multi-file diff editor. No GitHub, no
two-pane file-by-file tool, no leaving the editor.

## What it does

- **Command Palette: _Branch Diff…_** → one picker listing every other
  branch (local + remote) and the last 40 commits on the current branch.
- Pick a branch or commit → `git diff <picked>..HEAD` opens stacked in the
  native multi-diff editor: every changed file in one scrollable view, with
  syntax highlighting, rename detection, native theme, and live refresh as
  files change (ideal for watching agent edits land).
- Added / deleted / renamed files are handled via the git `Status` enum;
  refs are resolved to commit SHAs so `toGitUri` resolves reliably; the
  absent side of an add/delete is `undefined` (API-supported) rather than a
  ref where the file doesn't exist.

Backed entirely by `git` + the built-in `vscode.git` API
(`diffBetween`, `toGitUri`) and the stable `vscode.changes` command. Pure
JS, zero dependencies, no build step.

## Relation to the native multi-diff editor

VS Code already opens a native multi-diff for the working tree, staged
changes, or a commit range selected in the Source Control Graph. Branch Diff
adds the one entry point that isn't built in: an ad-hoc
**current-branch vs. arbitrary branch-or-commit** comparison, from a single
Command Palette command — without hunting through the Graph or staging
anything. Same native editor, just reachable for the PR-style question
"what's different between here and there".

## Known gap

Ad-hoc branch comparisons don't appear in the Source Control "Changes"
group (it isn't working-tree state) and the multi-diff editor has no
file-list / jump-tree like GitHub's PR sidebar — with many files you scroll
blind. A contributed file-overview tree is the candidate fix, not yet built.

## Development

Pure JS — no build. Press <kbd>F5</kbd> ("Run Extension") to launch an
Extension Development Host with the extension loaded; edit `extension.js`
and reload the dev host to iterate. See [RELEASING.md](RELEASING.md) for
packaging.

## License

MIT © Thimo Jansen
