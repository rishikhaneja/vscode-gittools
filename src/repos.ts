import * as vscode from "vscode";
import * as path from "path";

export interface Repo {
  name: string;
  path: string;
}

// Minimal shape of the built-in Git extension's API — enough to enumerate repos.
interface GitRepository {
  rootUri: vscode.Uri;
}
interface GitAPI {
  repositories: GitRepository[];
}
interface GitExtensionExports {
  getAPI(version: 1): GitAPI;
}

/**
 * Every git repo VS Code has detected in the workspace — including the sub-repos
 * of a meta-repo (VS Code auto-detects nested `.git` dirs).
 */
export async function getWorkspaceRepos(): Promise<Repo[]> {
  const ext = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
  if (!ext) {
    return [];
  }
  const exports = ext.isActive ? ext.exports : await ext.activate();
  const api = exports.getAPI(1);
  return api.repositories.map((r) => ({
    path: r.rootUri.fsPath,
    name: path.basename(r.rootUri.fsPath),
  }));
}
