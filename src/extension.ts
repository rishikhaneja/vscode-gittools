import * as vscode from "vscode";
import { deleteStaleBranches } from "./picker";
import { openInGitExtensions } from "./gitext";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("gitTools.deleteStaleBranches", () => deleteStaleBranches()),
    vscode.commands.registerCommand("gitTools.openInGitExtensions", (arg) => openInGitExtensions(arg)),
  );
}

export function deactivate() {}
