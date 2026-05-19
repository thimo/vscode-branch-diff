"use strict";

const vscode = require("vscode");

/**
 * Branch Diff — opens VS Code's native multi-file diff editor for the
 * changes between the current branch (HEAD) and a base you pick: another
 * branch, or an earlier commit on the current branch.
 * Pure JS, no build step. Leans on the built-in vscode.git API and the
 * stable `vscode.changes` command.
 */

function getGitApi() {
  const ext = vscode.extensions.getExtension("vscode.git");
  if (!ext) {
    throw new Error("Built-in Git extension not found.");
  }
  const exports = ext.isActive ? ext.exports : undefined;
  if (!exports || !exports.enabled) {
    throw new Error("Git extension is not enabled yet — open a Git repo first.");
  }
  return exports.getAPI(1);
}

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
// on the current branch. Returns the selected ref string, or undefined.
async function pickBase(repo, headName) {
  const Separator = vscode.QuickPickItemKind.Separator;

  const branchNames = await listBranchNames(repo, headName);

  let commits = [];
  try {
    commits = await repo.log({ maxEntries: 40 });
  } catch (_) {
    /* log failing shouldn't kill the branch flow */
  }

  const items = [];

  if (branchNames.length) {
    items.push({ label: "Branches", kind: Separator });
    for (const name of branchNames) {
      items.push({ label: name, ref: name });
    }
  }

  if (commits.length) {
    items.push({
      label: `Recent commits on ${headName}`,
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
  return pick && pick.ref;
}

async function openBranchDiff() {
  let api;
  try {
    api = getGitApi();
  } catch (e) {
    vscode.window.showErrorMessage("Branch Diff: " + e.message);
    return;
  }

  const repo = await pickRepository(api).catch((e) => {
    vscode.window.showErrorMessage("Branch Diff: " + e.message);
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

  const base = await pickBase(repo, headName);
  if (!base) {
    return;
  }

  let changes;
  try {
    changes = await repo.diffBetween(base, headName);
  } catch (e) {
    vscode.window.showErrorMessage(`Branch Diff: git diff ${base}..${headName} failed: ${e.message}`);
    return;
  }

  if (!changes || changes.length === 0) {
    vscode.window.showInformationMessage(`Branch Diff: no differences between ${base} and ${headName}.`);
    return;
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

  // git Status enum (const enum, 0-based, from the built-in git API).
  const S_INDEX_ADDED = 1;
  const S_INDEX_DELETED = 2;
  const S_DELETED = 6;

  const resourceList = changes.map((c) => {
    const label = c.renameUri || c.uri;
    const isAdded = c.status === S_INDEX_ADDED;
    const isDeleted = c.status === S_INDEX_DELETED || c.status === S_DELETED;
    // Absent side must be undefined (API-supported) — pointing at a ref
    // where the file does not exist is what produced "No Changed Files".
    const left = isAdded ? undefined : api.toGitUri(c.originalUri, baseRef);
    const right = isDeleted ? undefined : api.toGitUri(label, headRef);
    return [label, left, right];
  });

  const baseLabel = base.length >= 40 ? base.slice(0, 8) : base;
  await vscode.commands.executeCommand(
    "vscode.changes",
    `${baseLabel} ↔ ${headName} (${changes.length})`,
    resourceList
  );
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("branchDiff.open", openBranchDiff)
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
