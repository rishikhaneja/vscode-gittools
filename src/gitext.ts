import * as vscode from "vscode";
import { spawn } from "child_process";
import { getWorkspaceRepos } from "./repos";

// scm/sourceControl commands receive the clicked repo's SourceControl, whose
// rootUri is the repo root. From the palette there's no arg — pick a repo.
interface SourceControlLike {
  rootUri?: vscode.Uri;
}

interface RepoItem extends vscode.QuickPickItem {
  path: string;
}

/** Open a repo in the Git Extensions GUI (`gitex browse <root>`). */
export async function openInGitExtensions(arg?: SourceControlLike): Promise<void> {
  const root = arg?.rootUri?.fsPath ?? (await pickRepo());
  if (!root) {
    return;
  }
  // gitex is a .cmd; run it via cmd.exe so the args array quotes root for us
  // (Node blocks spawning a .cmd directly, and this keeps it injection-free).
  const child = spawn("cmd.exe", ["/c", "gitex", "browse", root], { detached: true, stdio: "ignore" });
  child.on("error", (e) =>
    vscode.window.showErrorMessage(`Git Tools: couldn't launch Git Extensions — ${e.message}`),
  );
  // gitex.cmd start /B's the GUI and returns at once, so a non-zero exit here is a
  // launch failure (e.g. gitex not on PATH), not the window being closed later.
  child.on("exit", (code) => {
    if (code) {
      vscode.window.showErrorMessage(`Git Tools: gitex exited with code ${code} — is Git Extensions on PATH?`);
    }
  });
  child.unref();
}

/** Palette fallback (no repo arg): the lone workspace repo, or a prompt. */
async function pickRepo(): Promise<string | undefined> {
  const repos = await getWorkspaceRepos();
  if (repos.length === 0) {
    vscode.window.showInformationMessage("Git Tools: no git repositories found in this workspace.");
    return undefined;
  }
  if (repos.length === 1) {
    return repos[0].path;
  }
  const pick = await vscode.window.showQuickPick<RepoItem>(
    repos.map((r) => ({ label: r.name, description: r.path, path: r.path })),
    { placeHolder: "Open which repo in Git Extensions?" },
  );
  return pick?.path;
}
