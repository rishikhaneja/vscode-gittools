import { gh } from "./exec";

export interface MergedPr {
  number: number;
  headRefName: string;
  headRefOid: string;
  mergedAt: string;
}

export interface MergedPrLookup {
  /** false when gh is missing, unauthenticated, offline, or the remote isn't GitHub. */
  available: boolean;
  /** headRefName -> most recently merged PR for that branch. */
  byHead: Map<string, MergedPr>;
}

/** Extract "owner/repo" from a git remote URL (ssh or https), or null if not GitHub. */
export function parseSlug(remoteUrl: string): string | null {
  const m = remoteUrl.trim().match(/github\.com[:/]([^/]+\/[^/\s]+?)(?:\.git)?$/);
  return m ? m[1] : null;
}

/** One batched `gh pr list --state merged` per repo, indexed by head branch name. */
export async function getMergedPrs(repoPath: string, remoteUrl: string | null): Promise<MergedPrLookup> {
  const slug = remoteUrl ? parseSlug(remoteUrl) : null;
  if (!slug) {
    return { available: false, byHead: new Map() };
  }
  try {
    const out = await gh(repoPath, [
      "pr", "list", "-R", slug, "--state", "merged",
      "--json", "number,headRefName,headRefOid,mergedAt",
      "--limit", "300",
    ]);
    const prs = JSON.parse(out) as MergedPr[];
    const byHead = new Map<string, MergedPr>();
    for (const pr of prs) {
      const existing = byHead.get(pr.headRefName);
      // mergedAt is ISO 8601, so lexical comparison gives recency.
      if (!existing || pr.mergedAt > existing.mergedAt) {
        byHead.set(pr.headRefName, pr);
      }
    }
    return { available: true, byHead };
  } catch {
    return { available: false, byHead: new Map() };
  }
}
