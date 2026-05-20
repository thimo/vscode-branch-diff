# Releasing

How to cut a release of `branch-diff`.

## Versioning (SemVer)

- **Patch** `0.x.y` — bug fixes, no surface change
- **Minor** `0.y.0` — new commands, new view affordances, new settings
- **Major** `x.0.0` — breaking changes (renamed commands, settings keys
  removed, API requirements bumped)

## Day-to-day development (no version bump)

Press <kbd>F5</kbd> in this project ("Run Extension") → a second VS Code
window (Extension Development Host) opens with the extension loaded from
source. Edit `extension.js`, then in the dev host run **Developer: Reload
Window** (or restart F5) to pick up changes. No packaging, no install, no
version bump.

## One-time setup

- VS Code Marketplace personal access token, stored locally so
  `vsce publish` can authenticate. See
  [the vsce docs](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token).
  Either `vsce login thimo` (interactive) or `export VSCE_PAT=…` in your
  shell rc.
- `gh` CLI logged in (`gh auth status`).
- `librsvg` for icon regeneration (`brew install librsvg` → `rsvg-convert`
  on PATH). The release script verifies the committed PNG matches the SVG.

## Automated release

Write release notes under `## Unreleased` in `CHANGELOG.md` first — the
script bails if that section is missing or empty. Lean verbose; explain
the *why* of each change, not just the *what*.

Then:

```bash
npm run release -- 0.2.0
```

That single command runs the full flow: pre-flight checks, version bump,
CHANGELOG date-stamp, commit, tag, `.vsix` build, smoke-test pause,
marketplace publish, `git push`, GitHub release with the `.vsix` attached.

The smoke-test pause is the last reversible point — once you confirm, the
script publishes externally.

### Flags

- `--skip-smoke-test` — skip the manual confirmation prompt (CI / re-run)
- `--no-marketplace` — skip the marketplace publish step (e.g. iterating
  on a release that's already up)
- `--dry-run` — print every command without executing

### Rolling back before push

If the smoke test fails, abort at the prompt. Local state is recoverable:

```bash
git tag -d v0.2.0
git reset --hard HEAD~1
trash branchdiff-0.2.0.vsix
```

### Rolling back after push

You can't unpublish from the marketplace (only deprecate). For GitHub:

```bash
gh release delete v0.2.0
git push origin :refs/tags/v0.2.0
git tag -d v0.2.0
```

Don't `git reset` published commits — push a follow-up fix instead.

## Manual flow (reference)

The script just automates this. Useful when the script breaks or you need
to do partial work.

```bash
git switch main
git pull --ff-only
node --check extension.js
rsvg-convert -w 1024 -h 1024 media/icon.svg -o media/icon.png   # if SVG changed
```

1. `package.json` → `"version"` — single source of truth.
2. `CHANGELOG.md` → `## Unreleased` becomes `## [X.Y.Z] — YYYY-MM-DD`.

```bash
git add package.json CHANGELOG.md
git commit -m "Release X.Y.Z"
git tag vX.Y.Z
npx vsce package --no-dependencies --out branchdiff-X.Y.Z.vsix
```

Smoke test:

```bash
code --install-extension branchdiff-X.Y.Z.vsix --force
```

Reload your main VS Code window and exercise the changes in a real repo
(open the view, change base, switch tree/list, refresh).

```bash
npm run publish:marketplace -- --packagePath branchdiff-X.Y.Z.vsix
git push origin main
git push origin vX.Y.Z

gh release create vX.Y.Z branchdiff-X.Y.Z.vsix \
  --title "vX.Y.Z" \
  --notes-file <(awk '/^## \[X\.Y\.Z\]/{flag=1; next} /^## \[/{flag=0} flag' CHANGELOG.md)
```

The `awk` pulls the just-released CHANGELOG section as the release body.
Replace `X\.Y\.Z` with the actual version (escaping the dots). The release
must include the `.vsix` so users who don't use the marketplace (or want
to pin a version) can install it manually.

## Icon

`media/icon.svg` is the source; `media/icon.png` is what `package.json`
references and what `vsce` bundles. Regenerate the PNG after **any** edit
to the SVG, or the two drift — the release script's pre-flight check
fails if they're out of sync:

```bash
rsvg-convert -w 1024 -h 1024 media/icon.svg -o media/icon.png
```

(`brew install librsvg` if `rsvg-convert` is missing.)

## Verify

- Marketplace listing shows the new version:
  <https://marketplace.visualstudio.com/items?itemName=thimo.branchdiff>
- GitHub release is "Latest":
  <https://github.com/thimo/vscode-branch-diff/releases>

## Troubleshooting

- **`vsce publish` says "Make sure to edit the README.md…"** — the
  bundled vsce sometimes flags placeholder text. Re-read README.md and
  make sure it doesn't include the boilerplate from `yo code` (it
  shouldn't — this repo's README was hand-written).
- **VS Code Extension Development Host doesn't pick up new code** —
  `Developer: Reload Window`, or restart F5.
- **Tag already exists locally** — `git tag -d vX.Y.Z` then re-tag. Don't
  do this once a release is out — it breaks anyone who downloaded the tag.
