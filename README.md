# vscode-gittools

Personal VS Code extension with git helpers. One command so far: **Delete Stale Branches**.

## Delete Stale Branches

Command Palette → **Git Tools: Delete Stale Branches** (also a trash button in the Source Control title bar).

1. **Auto fetch + prune** every git repo in the workspace (including the sub-repos of a meta-repo), so "gone" markers are current.
2. **Gather** local branches whose upstream is gone, via `git for-each-ref` — no `git branch -vv` parsing, so no `*`/`+`/color junk in the names.
3. **Classify** each branch and open a multi-select picker, grouped by repo. Pre-checked = verified safe to delete.
4. On accept, delete the checked branches with `git branch -D`. Anything not verified merged is gated behind a modal.

### How a branch is classified

A "stale" branch is one whose upstream is **gone** (its remote branch was deleted — which GitHub does on PR merge). Since squash-merges aren't reachable from the base branch, `git branch -d` can't confirm the merge, so the check asks the source of truth:

| Verdict | Meaning | Delete |
|---|---|---|
| `safe` (pre-checked) | A merged PR with this head branch exists, **and** the local tip has no commits beyond the PR's merged head | `-D`, no prompt |
| `warn` | Merged PR found but local tip is ahead of the merged head, or no merged PR found, or gh unavailable | `-D` only after a modal confirm |
| `current` | The checked-out branch | never (skipped) |

Merge status comes from one batched `gh pr list --state merged` per repo, matched by head branch name and verified against the PR's head SHA. This is why **multi-commit squash merges classify correctly** — the check never relies on commit reachability.

**Fallback:** if `gh` is missing/unauthenticated/offline, the extension falls back to a whole-branch patch-id match against the base branch (finds the squash commit). This handles clean multi-commit squashes but breaks if the squash was hand-edited, so those rows are marked heuristic and require manual confirm.

## Dev dependencies

| Package | Why |
|---|---|
| `@types/vscode` | VS Code extension API types |
| `@types/node` | Node types for `child_process` etc. |
| `typescript` | Compiler |

## Install locally

```sh
npm install && npm run compile

# Symlink into VS Code's extensions dir (Developer Mode on, or run elevated)
cmd //c mklink /D "%USERPROFILE%\.vscode\extensions\vscode-gittools" "d:\code\misc\vscode-gittools"
```

Reload VS Code after symlinking. After code changes, `npm run compile` (or `npm run watch`) and reload.

Or press **F5** in this folder to launch an Extension Development Host without symlinking.
