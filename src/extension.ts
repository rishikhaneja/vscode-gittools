import * as vscode from "vscode";
import { deleteStaleBranches } from "./picker";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("gitTools.deleteStaleBranches", () => deleteStaleBranches()),
  );
}

export function deactivate() {}
