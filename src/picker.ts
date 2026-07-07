import * as vscode from "vscode";
import { git } from "./exec";
import { getWorkspaceRepos, Repo } from "./repos";
import { gatherStale, StaleBranch } from "./stale";

interface BranchItem extends vscode.QuickPickItem {
  branch?: StaleBranch;
}

const output = vscode.window.createOutputChannel("Git Tools");

export async function deleteStaleBranches(): Promise<void> {
  const repos = await getWorkspaceRepos();
  if (repos.length === 0) {
    vscode.window.showInformationMessage("Git Tools: no git repositories found in this workspace.");
    return;
  }

  const branches = await load(repos);
  if (branches.length === 0) {
    vscode.window.showInformationMessage("Git Tools: nothing stale — all clean ✨");
    return;
  }

  showPicker(repos, branches);
}

/** Auto fetch --prune every repo, then gather + classify stale branches. */
async function load(repos: Repo[]): Promise<StaleBranch[]> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Git Tools", cancellable: false },
    async (progress) => {
      progress.report({ message: `Pruning ${repos.length} repo(s)…` });
      await Promise.all(
        repos.map((r) =>
          git(r.path, ["fetch", "--prune"]).catch((e) => output.appendLine(`fetch failed in ${r.name}: ${e}`)),
        ),
      );
      progress.report({ message: "Finding stale branches…" });
      return gatherStale(repos);
    },
  );
}

function toItem(b: StaleBranch): BranchItem {
  const icon = b.verdict === "safe" ? "$(git-branch)" : b.verdict === "warn" ? "$(warning)" : "$(circle-slash)";
  const description = [b.reason, b.dateRel].filter(Boolean).join(" · ");
  return {
    label: `${icon} ${b.name}`,
    description,
    detail: b.subject || undefined,
    branch: b,
  };
}

function buildItems(branches: StaleBranch[]): { items: BranchItem[]; preselect: BranchItem[] } {
  const byRepo = new Map<string, StaleBranch[]>();
  for (const b of branches) {
    const list = byRepo.get(b.repo.name) ?? [];
    list.push(b);
    byRepo.set(b.repo.name, list);
  }
  const items: BranchItem[] = [];
  const preselect: BranchItem[] = [];
  for (const [repoName, list] of byRepo) {
    items.push({ label: repoName, kind: vscode.QuickPickItemKind.Separator });
    for (const b of list) {
      const item = toItem(b);
      items.push(item);
      // Pre-check only verified-safe branches; warn/current start unchecked.
      if (b.verdict === "safe") {
        preselect.push(item);
      }
    }
  }
  return { items, preselect };
}

function showPicker(repos: Repo[], branches: StaleBranch[]): void {
  const qp = vscode.window.createQuickPick<BranchItem>();
  qp.title = "Delete stale branches";
  qp.placeholder = "Space toggles · Enter deletes · pre-checked = verified merged & safe";
  qp.canSelectMany = true;
  qp.matchOnDescription = true;
  qp.matchOnDetail = true;

  const refreshBtn: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon("refresh"),
    tooltip: "Refresh (fetch --prune)",
  };
  qp.buttons = [refreshBtn];

  const render = (list: StaleBranch[]) => {
    const { items, preselect } = buildItems(list);
    qp.items = items;
    qp.selectedItems = preselect;
  };
  render(branches);

  qp.onDidTriggerButton(async (btn) => {
    if (btn !== refreshBtn) {
      return;
    }
    qp.busy = true;
    const fresh = await load(repos);
    qp.busy = false;
    if (fresh.length === 0) {
      qp.hide();
      vscode.window.showInformationMessage("Git Tools: nothing stale — all clean ✨");
      return;
    }
    render(fresh);
  });

  qp.onDidAccept(async () => {
    const chosen = qp.selectedItems.map((i) => i.branch).filter((b): b is StaleBranch => b !== undefined);
    qp.hide();
    if (chosen.length > 0) {
      await confirmAndDelete(chosen);
    }
  });

  qp.onDidHide(() => qp.dispose());
  qp.show();
}

async function confirmAndDelete(chosen: StaleBranch[]): Promise<void> {
  const current = chosen.filter((b) => b.verdict === "current");
  const deletable = chosen.filter((b) => b.verdict !== "current");
  const risky = deletable.filter((b) => b.verdict === "warn");

  if (current.length > 0) {
    vscode.window.showWarningMessage(
      `Git Tools: skipping ${current.length} checked-out branch(es) — can't delete the current branch.`,
    );
  }
  if (deletable.length === 0) {
    return;
  }

  if (risky.length > 0) {
    const proceed = await vscode.window.showWarningMessage(
      `${risky.length} of ${deletable.length} selected branch(es) aren't verified as fully merged — local commits may be lost. Delete anyway with -D?`,
      { modal: true },
      "Delete",
    );
    if (proceed !== "Delete") {
      return;
    }
  }

  const results = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Git Tools: deleting branches" },
    async () => {
      const out: { b: StaleBranch; ok: boolean; err?: string }[] = [];
      for (const b of deletable) {
        try {
          // Force delete: gone squash-merged branches aren't reachable, so `-d`
          // would refuse them. Safety comes from the verification above, not `-d`.
          await git(b.repo.path, ["branch", "-D", b.name]);
          out.push({ b, ok: true });
        } catch (e) {
          out.push({ b, ok: false, err: String(e) });
        }
      }
      return out;
    },
  );

  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const repoCount = new Set(ok.map((r) => r.b.repo.name)).size;
  for (const r of results) {
    output.appendLine(`${r.ok ? "deleted" : "FAILED "} ${r.b.repo.name}/${r.b.name}${r.err ? " — " + r.err : ""}`);
  }

  let msg = `Git Tools: deleted ${ok.length} branch(es) across ${repoCount} repo(s).`;
  if (failed.length > 0) {
    msg += ` ${failed.length} failed.`;
  }
  const choice = await vscode.window.showInformationMessage(msg, "Show Log");
  if (choice === "Show Log") {
    output.show();
  }
}
