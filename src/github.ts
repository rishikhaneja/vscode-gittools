import { gh } from "./exec";

export interface HeadPr {
  number: number;
  /** "OPEN" | "CLOSED" | "MERGED" */
  state: string;
  mergedAt: string | null;
  headRefOid: string;
  url: string;
}

/** Extract "owner/repo" from a git remote URL (ssh or https), or null if not GitHub. */
export function parseSlug(remoteUrl: string): string | null {
  const m = remoteUrl.trim().match(/github\.com[:/]([^/]+\/[^/\s]+?)(?:\.git)?$/);
  return m ? m[1] : null;
}

/**
 * PRs whose head is `branch`, any state. `available` is false only when gh itself
 * can't be used (missing / unauthenticated / offline) so callers can fall back —
 * an empty `prs` with `available: true` means "gh works, this branch had no PR".
 *
 * Queried per branch rather than as one capped `--state merged` batch, so it's
 * authoritative no matter how many PRs the repo has.
 */
export async function prsForHead(
  repoPath: string,
  slug: string,
  branch: string,
): Promise<{ available: boolean; prs: HeadPr[] }> {
  try {
    const out = await gh(repoPath, [
      "pr", "list", "-R", slug, "--head", branch, "--state", "all",
      "--json", "number,state,mergedAt,headRefOid,url",
      "--limit", "20",
    ]);
    return { available: true, prs: JSON.parse(out) as HeadPr[] };
  } catch {
    return { available: false, prs: [] };
  }
}

/** Most recently merged PR among the given, or undefined if none merged. */
export function pickMerged(prs: HeadPr[]): HeadPr | undefined {
  const merged = prs.filter((p) => p.mergedAt !== null);
  if (merged.length === 0) {
    return undefined;
  }
  return merged.reduce((a, b) => (b.mergedAt! > a.mergedAt! ? b : a));
}

/** Newest PR (highest number) for context/linking when none merged. */
export function pickLatest(prs: HeadPr[]): HeadPr | undefined {
  if (prs.length === 0) {
    return undefined;
  }
  return prs.reduce((a, b) => (b.number > a.number ? b : a));
}
