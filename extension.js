// @ts-check
"use strict";

const vscode = require("vscode");
const path = require("path");

/** @typedef {import("./git").API} GitAPI */
/** @typedef {import("./git").Repository} GitRepository */
/** @typedef {import("./git").Change} GitChange */
/** @typedef {import("./git").DiffChange} GitDiffChange */

/**
 * One row in the Branch Diff file list. `kind` discriminates against
 * {@link FolderNode} in tree mode.
 * @typedef {object} FileNode
 * @property {"file"} kind
 * @property {number} status        git Status enum value
 * @property {vscode.Uri} resourceUri  working-tree uri (file icon + theme)
 * @property {string} name          basename
 * @property {string} dir           dir relative to repo root ("" if root)
 * @property {string} relPath       full path relative to repo root
 * @property {vscode.Uri|undefined} left   base side, undefined if added
 * @property {vscode.Uri|undefined} right  head side, undefined if deleted
 * @property {number} [insertions]  added lines, when stats are available
 * @property {number} [deletions]   removed lines, when stats are available
 */

/**
 * Intermediate row in tree mode. `name` carries the (possibly
 * compact-folder-joined) segment, e.g. "src/lib". `absPath` is the
 * deepest folder in that chain so a `Uri.file(absPath)` resourceUri
 * gives the theme's folder icon.
 * @typedef {object} FolderNode
 * @property {"folder"} kind
 * @property {string} name
 * @property {string} absPath
 * @property {TreeRow[]} children
 */

/** @typedef {FileNode | FolderNode} TreeRow */

/**
 * The currently displayed comparison. `multiDiffSourceUri` is the stable
 * identity for the native multi-diff editor — re-invoking
 * `_workbench.openMultiDiffEditor` with the same URI focuses that editor
 * (instead of opening a duplicate) and lets us pass `reveal.modifiedUri`
 * to scroll to a specific file.
 * @typedef {object} Comparison
 * @property {string} baseLabel
 * @property {string} headName
 * @property {string} title
 * @property {vscode.Uri} multiDiffSourceUri
 * @property {{ originalUri: vscode.Uri|undefined, modifiedUri: vscode.Uri|undefined }[]} multiDiffResources
 * @property {FileNode[]} nodes
 * @property {string} rootFsPath
 */

/**
 * What the user picked in the base picker. Branches mean "diff HEAD against
 * that tip" (`branchTip..HEAD`). Commits mean "from this commit onwards,
 * including its own changes" — implemented as `commit^..HEAD`, since
 * `commit..HEAD` would exclude the commit's own changes (counter-intuitive
 * when you've just clicked it).
 * @typedef {{ ref: string, kind: "branch" | "commit" }} BaseSelection
 */

/** Normalise an unknown thrown value to a message string. */
function msg(/** @type {unknown} */ e) {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Branch Diff — opens VS Code's native multi-file diff editor for the
 * changes between the current branch (HEAD) and a base you pick: another
 * branch, or an earlier commit on the current branch.
 * Pure JS, no build step. Leans on the built-in vscode.git API and the
 * stable `vscode.changes` command.
 */

/** @returns {GitAPI} */
function getGitApi() {
  const ext = vscode.extensions.getExtension("vscode.git");
  if (!ext) {
    throw new Error("Built-in Git extension not found.");
  }
  const gitExt = /** @type {import("./git").GitExtension|undefined} */ (
    ext.isActive ? ext.exports : undefined
  );
  if (!gitExt || !gitExt.enabled) {
    throw new Error("Git extension is not enabled yet — open a Git repo first.");
  }
  return gitExt.getAPI(1);
}

/** @param {GitAPI} api @returns {Promise<GitRepository|undefined>} */
async function pickRepository(api) {
  const repos = api.repositories;
  if (repos.length === 0) {
    throw new Error("No Git repository open.");
  }
  if (repos.length === 1) {
    return repos[0];
  }
  const pick = await vscode.window.showQuickPick(
    repos.map((r) => ({ label: r.rootUri.fsPath, repo: r })),
    { placeHolder: "Which repository?" }
  );
  return pick && pick.repo;
}

/** @param {GitRepository} repo @param {string} headName @returns {Promise<string[]>} */
async function listBranchNames(repo, headName) {
  const names = new Set();
  for (const query of [{ remote: false }, { remote: true }]) {
    try {
      const refs = await repo.getBranches(query);
      for (const ref of refs) {
        if (ref && ref.name && ref.name !== headName) {
          names.add(ref.name);
        }
      }
    } catch (_) {
      /* one query failing (e.g. no remotes) is fine */
    }
  }
  const all = [...names];
  const preferred = ["main", "master", "develop", "development"];
  all.sort((a, b) => {
    const pa = preferred.indexOf(a);
    const pb = preferred.indexOf(b);
    if (pa !== -1 || pb !== -1) {
      return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
    }
    return a.localeCompare(b);
  });
  return all;
}

function shortDate(d) {
  if (!(d instanceof Date) || isNaN(d)) return "";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Build the unified base picker: branches first, then the last N commits
// on the current branch. Returns the selected base + its kind, or undefined.
/** @param {GitRepository} repo @param {string} headName @returns {Promise<BaseSelection|undefined>} */
async function pickBase(repo, headName) {
  const Separator = vscode.QuickPickItemKind.Separator;

  const branchNames = await listBranchNames(repo, headName);

  /** @type {import("./git").Commit[]} */
  let commits = [];
  try {
    commits = await repo.log({ maxEntries: 40 });
  } catch (_) {
    /* log failing shouldn't kill the branch flow */
  }

  /** @type {(vscode.QuickPickItem & { ref?: string, baseKind?: "branch"|"commit" })[]} */
  const items = [];

  if (branchNames.length) {
    items.push({ label: "Branches", kind: Separator });
    for (const name of branchNames) {
      items.push({ label: name, ref: name, baseKind: "branch" });
    }
  }

  if (commits.length) {
    items.push({
      label: `Recent commits on ${headName} (since this commit, inclusive)`,
      kind: Separator,
    });
    for (const c of commits) {
      const subject = (c.message || "").split("\n")[0].trim() || "(no message)";
      const shortHash = (c.hash || "").slice(0, 8);
      const when = shortDate(c.commitDate || c.authorDate);
      items.push({
        label: subject,
        description: when ? `${shortHash} · ${when}` : shortHash,
        ref: c.hash,
        baseKind: "commit",
      });
    }
  }

  if (items.length === 0) {
    return undefined;
  }

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Diff ${headName} against… (branch or earlier commit)`,
    matchOnDescription: true,
  });
  if (!pick || !pick.ref) return undefined;
  return { ref: pick.ref, kind: pick.baseKind || "branch" };
}

// git Status enum (const enum, 0-based, from the built-in git API).
const S_INDEX_MODIFIED = 0;
const S_INDEX_ADDED = 1;
const S_INDEX_DELETED = 2;
const S_INDEX_RENAMED = 3;
const S_INDEX_COPIED = 4;
const S_MODIFIED = 5;
const S_DELETED = 6;

/**
 * Badge/icon/word for a git Status value. The diff API reports the
 * INDEX_* family; MODIFIED/DELETED show up too, so handle both.
 * @param {number} status
 */
function statusMeta(status) {
  switch (status) {
    case S_INDEX_ADDED:
      return { letter: "A", icon: "diff-added", color: "gitDecoration.addedResourceForeground", word: "Added" };
    case S_INDEX_COPIED:
      return { letter: "C", icon: "diff-added", color: "gitDecoration.addedResourceForeground", word: "Copied" };
    case S_INDEX_DELETED:
    case S_DELETED:
      return { letter: "D", icon: "diff-removed", color: "gitDecoration.deletedResourceForeground", word: "Deleted" };
    case S_INDEX_RENAMED:
      return { letter: "R", icon: "diff-renamed", color: "gitDecoration.renamedResourceForeground", word: "Renamed" };
    case S_INDEX_MODIFIED:
    case S_MODIFIED:
    default:
      return { letter: "M", icon: "diff-modified", color: "gitDecoration.modifiedResourceForeground", word: "Modified" };
  }
}

/**
 * Build a folder tree from a flat list of {@link FileNode}s. Optionally
 * compact-folder-collapses chains of single-subfolder folders (e.g.
 * `a/b/c/file` becomes one `a/b/c` row with `file` inside) — matches
 * the `scm.compactFolders` behaviour.
 * @param {string} rootFsPath
 * @param {FileNode[]} files
 * @param {boolean} compact
 * @returns {TreeRow[]}
 */
function buildTree(rootFsPath, files, compact) {
  /** @typedef {{ kind: "folder", name: string, absPath: string, children: TreeRow[], _byName: Map<string, FolderNode> }} BuildFolder */
  /** @type {BuildFolder} */
  const root = { kind: "folder", name: "", absPath: rootFsPath, children: [], _byName: new Map() };

  for (const f of files) {
    const parts = f.relPath.split(path.sep);
    /** @type {BuildFolder} */
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      let next = /** @type {BuildFolder|undefined} */ (cursor._byName.get(seg));
      if (!next) {
        next = {
          kind: "folder",
          name: seg,
          absPath: path.join(cursor.absPath, seg),
          children: [],
          _byName: new Map(),
        };
        cursor._byName.set(seg, next);
        cursor.children.push(next);
      }
      cursor = next;
    }
    cursor.children.push(f);
  }

  /** @param {BuildFolder} node */
  function postProcess(node) {
    // Recurse first so compaction sees already-compacted descendants.
    for (const child of node.children) {
      if (child.kind === "folder") postProcess(/** @type {BuildFolder} */ (child));
    }
    if (compact) {
      for (let i = 0; i < node.children.length; i++) {
        let c = node.children[i];
        while (
          c.kind === "folder" &&
          c.children.length === 1 &&
          c.children[0].kind === "folder"
        ) {
          const only = /** @type {FolderNode} */ (c.children[0]);
          c.name = `${c.name}${path.sep}${only.name}`;
          c.absPath = only.absPath;
          c.children = only.children;
        }
        node.children[i] = c;
      }
    }
    node.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    // strip the build-only Map so the returned shape matches FolderNode.
    delete (/** @type {{ _byName?: unknown }} */ (node))._byName;
  }
  postProcess(root);
  return root.children;
}

/**
 * Backs the "Branch Diff" view in the Source Control container: the file
 * list for the active comparison, as either a flat list or a folder
 * tree. Selection of the base ref stays in the QuickPick (see
 * {@link pickBase}) — this view is overview only.
 * @implements {vscode.TreeDataProvider<TreeRow>}
 */
class FilesProvider {
  constructor() {
    /** @type {vscode.EventEmitter<void>} */
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
    /** @type {Comparison|undefined} */
    this.comparison = undefined;
    /** @type {"tree"|"list"} */
    this.viewMode = "tree";
    /** @type {boolean} */
    this.compactFolders = true;
    /** @type {TreeRow[]} */
    this._tree = [];
    this._readConfig();
  }

  _readConfig() {
    const cfg = vscode.workspace.getConfiguration("branchDiff");
    const mode = cfg.get("viewMode");
    this.viewMode = mode === "list" ? "list" : "tree";
    this.compactFolders = cfg.get("compactFolders") !== false;
  }

  _rebuildTree() {
    this._tree = this.comparison
      ? buildTree(this.comparison.rootFsPath, this.comparison.nodes, this.compactFolders)
      : [];
  }

  /** Re-read settings and rebuild the cached tree. Called from a config listener. */
  applyConfigChange() {
    this._readConfig();
    this._rebuildTree();
    this._emitter.fire();
  }

  /** @param {Comparison|undefined} c */
  setComparison(c) {
    this.comparison = c;
    this._rebuildTree();
    this._emitter.fire();
  }

  /**
   * @param {TreeRow} [element]
   * @returns {TreeRow[]}
   */
  getChildren(element) {
    if (!this.comparison) return [];
    if (!element) {
      return this.viewMode === "tree" ? this._tree : this.comparison.nodes;
    }
    return element.kind === "folder" ? element.children : [];
  }

  /** @param {TreeRow} node */
  getTreeItem(node) {
    if (node.kind === "folder") {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
      item.resourceUri = vscode.Uri.file(node.absPath); // gets the theme folder icon
      item.tooltip = node.absPath;
      item.contextValue = "branchDiff.folder";
      return item;
    }
    const m = statusMeta(node.status);
    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
    item.resourceUri = node.resourceUri;
    const stats =
      typeof node.insertions === "number" || typeof node.deletions === "number"
        ? `+${node.insertions || 0} −${node.deletions || 0}`
        : "";
    // In tree mode the dir is implicit from the parent folder; only show stats.
    const descParts = this.viewMode === "tree" ? [stats] : [node.dir, stats];
    item.description = descParts.filter(Boolean).join("  ") || undefined;
    item.tooltip = `${m.word} — ${node.relPath}`;
    item.iconPath = new vscode.ThemeIcon(m.icon, new vscode.ThemeColor(m.color));
    item.contextValue = "branchDiff.file";
    item.command = {
      command: "branchDiff.openChange",
      title: "Open Diff",
      arguments: [node],
    };
    return item;
  }
}

/** @type {FilesProvider} */
let provider;
/** @type {vscode.TreeView<TreeRow>} */
let treeView;
/** @type {{ repo: GitRepository, sel: BaseSelection, headName: string }|undefined} */
let lastRun;

/**
 * Turn the user's selection into the actual ref to diff against. For a
 * commit, that's its first parent — so the diff *includes* that commit's
 * own changes ("from this commit onwards"). For a branch, the tip is the
 * base unchanged.
 * @param {GitRepository} repo
 * @param {BaseSelection} sel
 * @returns {Promise<string>}
 */
async function resolveBaseRef(repo, sel) {
  if (sel.kind !== "commit") return sel.ref;
  const c = await repo.getCommit(sel.ref).catch(() => undefined);
  if (c && c.parents && c.parents.length > 0) {
    return c.parents[0];
  }
  vscode.window.showInformationMessage(
    "Branch Diff: this commit has no parent (root commit), so its own changes can't be shown — diffing against the commit itself."
  );
  return sel.ref;
}

/**
 * Diff `base..headName` and shape it for both the native multi-diff and
 * the file list. Uses `diffBetweenWithStats` for +/- counts when the
 * running VS Code is new enough, falling back to `diffBetween` (no
 * counts) so the engines floor (^1.80.0) keeps working.
 * @param {GitAPI} api
 * @param {GitRepository} repo
 * @param {string} base
 * @param {string} headName
 */
async function computeComparison(api, repo, base, headName) {
  /** @type {(GitChange|GitDiffChange)[]} */
  let changes;
  try {
    if (typeof repo.diffBetweenWithStats === "function") {
      changes = await repo.diffBetweenWithStats(base, headName);
    } else {
      changes = await repo.diffBetween(base, headName);
    }
  } catch (_) {
    // diffBetweenWithStats can exist but reject on edge cases — retry plain.
    changes = await repo.diffBetween(base, headName);
  }
  if (!changes || changes.length === 0) {
    return { changes: [], multiDiffResources: [], nodes: [], rootFsPath: repo.rootUri.fsPath };
  }

  // Resolve refs to commit hashes so toGitUri resolves reliably.
  let baseRef = base;
  let headRef = headName;
  try {
    const [bc, hc] = await Promise.all([
      repo.getCommit(base),
      repo.getCommit(headName),
    ]);
    if (bc && bc.hash) baseRef = bc.hash;
    if (hc && hc.hash) headRef = hc.hash;
  } catch (_) {
    /* fall back to ref names */
  }

  const rootFsPath = repo.rootUri.fsPath;
  /** @type {{ originalUri: vscode.Uri|undefined, modifiedUri: vscode.Uri|undefined }[]} */
  const multiDiffResources = [];
  /** @type {FileNode[]} */
  const nodes = [];

  for (const c of changes) {
    const label = c.renameUri || c.uri;
    const isAdded = c.status === S_INDEX_ADDED;
    const isDeleted = c.status === S_INDEX_DELETED || c.status === S_DELETED;
    // Absent side must be undefined (API-supported) — pointing at a ref
    // where the file does not exist is what produced "No Changed Files".
    const left = isAdded ? undefined : api.toGitUri(c.originalUri, baseRef);
    const right = isDeleted ? undefined : api.toGitUri(label, headRef);
    multiDiffResources.push({ originalUri: left, modifiedUri: right });

    const relPath = path.relative(rootFsPath, label.fsPath);
    const dir = path.dirname(relPath);
    const dc = /** @type {GitDiffChange} */ (c);
    nodes.push({
      kind: "file",
      status: c.status,
      resourceUri: label,
      name: path.basename(relPath),
      dir: dir === "." ? "" : dir,
      relPath,
      left,
      right,
      insertions: typeof dc.insertions === "number" ? dc.insertions : undefined,
      deletions: typeof dc.deletions === "number" ? dc.deletions : undefined,
    });
  }
  nodes.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return { changes, multiDiffResources, nodes, rootFsPath };
}

/**
 * Stable identity URI for one comparison. The scheme has no content
 * provider — this is purely an identifier so re-invoking
 * `_workbench.openMultiDiffEditor` with the same URI focuses the same
 * editor (and lets us reveal a specific row) instead of opening a
 * duplicate.
 * @param {GitRepository} repo
 * @param {string} base
 * @param {string} headName
 */
function makeSourceUri(repo, base, headName) {
  return vscode.Uri.from({
    scheme: "branch-diff",
    path: repo.rootUri.fsPath,
    query: `base=${encodeURIComponent(base)}&head=${encodeURIComponent(headName)}`,
  });
}

/**
 * Open the native multi-diff editor for the current comparison, optionally
 * scrolling to a specific file. Prefers the internal
 * `_workbench.openMultiDiffEditor` for its `reveal` arg; falls back to the
 * public `vscode.changes` (no reveal) if the internal one isn't there.
 * @param {Comparison} c
 * @param {vscode.Uri} [revealModifiedUri]
 */
async function openOrRevealMultiDiff(c, revealModifiedUri) {
  try {
    await vscode.commands.executeCommand("_workbench.openMultiDiffEditor", {
      multiDiffSourceUri: c.multiDiffSourceUri,
      title: c.title,
      resources: c.multiDiffResources,
      reveal: revealModifiedUri ? { modifiedUri: revealModifiedUri } : undefined,
    });
  } catch (_) {
    // Fallback: vscode.changes is public but takes [label, original, modified] triples and has no reveal.
    /** @type {[vscode.Uri, vscode.Uri|undefined, vscode.Uri|undefined][]} */
    const triples = c.multiDiffResources.map((r) => {
      const labelUri = r.modifiedUri || r.originalUri;
      // labelUri is only undefined when both sides are missing, which can't happen for a diff entry.
      return [/** @type {vscode.Uri} */ (labelUri), r.originalUri, r.modifiedUri];
    });
    await vscode.commands.executeCommand("vscode.changes", c.title, triples);
  }
}

/**
 * Run a comparison: open the native multi-diff and populate the view.
 * Labels and identity use `sel.ref` (what the user picked), so the view
 * header reads e.g. "main ↔ HEAD" or "5da9536d ↔ HEAD". The actual diff
 * uses {@link resolveBaseRef} (parent for a picked commit) so its own
 * changes are included.
 * @param {GitAPI} api
 * @param {GitRepository} repo
 * @param {BaseSelection} sel
 * @param {string} headName
 */
async function showComparison(api, repo, sel, headName) {
  const baseForDiff = await resolveBaseRef(repo, sel);
  const { changes, multiDiffResources, nodes, rootFsPath } = await computeComparison(api, repo, baseForDiff, headName);
  if (changes.length === 0) {
    vscode.window.showInformationMessage(`Branch Diff: no differences between ${sel.ref} and ${headName}.`);
    provider.setComparison(undefined);
    lastRun = undefined;
    return;
  }

  const baseLabel = sel.ref.length >= 40 ? sel.ref.slice(0, 8) : sel.ref;
  /** @type {Comparison} */
  const c = {
    baseLabel,
    headName,
    // The multi-diff editor auto-appends "(N files)" to the tab title, so
    // don't include the count here — would render duplicated.
    title: `${baseLabel} ↔ ${headName}`,
    multiDiffSourceUri: makeSourceUri(repo, sel.ref, headName),
    multiDiffResources,
    nodes,
    rootFsPath,
  };
  provider.setComparison(c);
  lastRun = { repo, sel, headName };
  await openOrRevealMultiDiff(c);
}

async function openBranchDiff() {
  /** @type {GitAPI} */
  let api;
  try {
    api = getGitApi();
  } catch (e) {
    vscode.window.showErrorMessage("Branch Diff: " + msg(e));
    return;
  }

  const repo = await pickRepository(api).catch((e) => {
    vscode.window.showErrorMessage("Branch Diff: " + msg(e));
    return undefined;
  });
  if (!repo) {
    return;
  }

  const head = repo.state.HEAD;
  const headName = head && (head.name || head.commit);
  if (!headName) {
    vscode.window.showErrorMessage("Branch Diff: current HEAD has no name (detached?).");
    return;
  }

  const sel = await pickBase(repo, headName);
  if (!sel) {
    return;
  }

  try {
    await showComparison(api, repo, sel, headName);
  } catch (e) {
    vscode.window.showErrorMessage(`Branch Diff: git diff ${sel.ref}..${headName} failed: ${msg(e)}`);
  }
}

/** Re-run the last comparison (base unchanged, HEAD re-read in case it moved). */
async function refresh() {
  if (!lastRun) {
    vscode.window.showInformationMessage("Branch Diff: nothing to refresh — run Branch Diff… first.");
    return;
  }
  /** @type {GitAPI} */
  let api;
  try {
    api = getGitApi();
  } catch (e) {
    vscode.window.showErrorMessage("Branch Diff: " + msg(e));
    return;
  }
  const { repo, sel } = lastRun;
  const head = repo.state.HEAD;
  const headName = (head && (head.name || head.commit)) || lastRun.headName;
  try {
    await showComparison(api, repo, sel, headName);
  } catch (e) {
    vscode.window.showErrorMessage(`Branch Diff: refresh failed: ${msg(e)}`);
  }
}

/**
 * Click in the tree → reveal that file inside the already-open multi-diff
 * (opening the multi-diff first if it isn't open yet). Deleted files have
 * no `modifiedUri`, which is what `reveal` keys on, so for those we fall
 * back to a standalone diff. Anything that goes wrong with the internal
 * reveal command also falls back — keeps the click reliable.
 * @param {FileNode} node
 */
async function openChange(node) {
  if (!node) {
    return;
  }
  const c = provider.comparison;
  if (c && node.right) {
    try {
      await openOrRevealMultiDiff(c, node.right);
      return;
    } catch (_) {
      /* fall through to standalone diff */
    }
  }
  const title = `${node.name} (${c ? c.baseLabel : "base"} ↔ ${c ? c.headName : "HEAD"})`;
  try {
    if (node.left && node.right) {
      await vscode.commands.executeCommand("vscode.diff", node.left, node.right, title);
    } else if (node.right) {
      await vscode.commands.executeCommand("vscode.open", node.right);
    } else if (node.left) {
      await vscode.commands.executeCommand("vscode.open", node.left);
    }
  } catch (e) {
    vscode.window.showErrorMessage(`Branch Diff: ${msg(e)}`);
  }
}

/** @param {"tree"|"list"} mode */
async function setViewMode(mode) {
  await vscode.workspace
    .getConfiguration("branchDiff")
    .update("viewMode", mode, vscode.ConfigurationTarget.Global);
  // The config listener in activate() picks this up and rebuilds the tree.
}

/** Reflect the active comparison in the view header (next to "BRANCH DIFF"). */
function updateTreeViewDescription() {
  const c = provider.comparison;
  treeView.description = c
    ? `${c.baseLabel} ↔ ${c.headName} · ${c.nodes.length} files`
    : undefined;
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  provider = new FilesProvider();
  // createTreeView (not registerTreeDataProvider) so we own the TreeView
  // handle and can mutate `description` / show the Collapse All affordance.
  treeView = vscode.window.createTreeView("branchDiff.files", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(
    provider._emitter,
    treeView,
    provider.onDidChangeTreeData(updateTreeViewDescription),
    vscode.commands.registerCommand("branchDiff.open", openBranchDiff),
    vscode.commands.registerCommand("branchDiff.changeBase", openBranchDiff),
    vscode.commands.registerCommand("branchDiff.refresh", refresh),
    vscode.commands.registerCommand("branchDiff.openChange", openChange),
    vscode.commands.registerCommand("branchDiff.setListView", () => setViewMode("list")),
    vscode.commands.registerCommand("branchDiff.setTreeView", () => setViewMode("tree")),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("branchDiff.viewMode") || e.affectsConfiguration("branchDiff.compactFolders")) {
        provider.applyConfigChange();
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
