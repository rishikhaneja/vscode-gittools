import { git, tryGit, pipeGit } from "./exec";
import { HeadPr, parseSlug, pickLatest, pickMerged, prsForHead } from "./github";
import { Repo } from "./repos";

export type Verdict = "safe" | "warn" | "current";

export interface StaleBranch {
  repo: Repo;
  name: string;
  /** Local branch tip SHA. */
  tip: string;
  dateRel: string;
  subject: string;
  verdict: Verdict;
  /** Human-readable classification note shown in the picker. */
  reason: string;
  /** Set when a PR (any state) is associated, so the picker can link it. */
  prNumber?: number;
  prUrl?: string;
}

type RawBranch = Pick<StaleBranch, "repo" | "name" | "tip" | "dateRel" | "subject"> & {
  isCurrent: boolean;
};

type HeadPrResult = { available: boolean; prs: HeadPr[] };

const TAB = "\t";

/**
 * Local branches whose upstream is gone, read via for-each-ref so there is no
 * `git branch -vv` output to parse — no `*`/`+` prefixes or color codes to trip on.
 */
async function goneBranches(repo: Repo): Promise<RawBranch[]> {
  const fmt = [
    "%(HEAD)",
    "%(refname:short)",
    "%(upstream:track)",
    "%(objectname)",
    "%(committerdate:relative)",
    "%(contents:subject)",
  ].join("%09");
  const out = await git(repo.path, ["for-each-ref", `--format=${fmt}`, "refs/heads"]);
  const rows: RawBranch[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split(TAB);
    const [head, name, track, tip, dateRel] = parts;
    // Subject may in theory contain a tab; keep everything after field 5.
    const subject = parts.slice(5).join(TAB);
    if (track !== "[gone]") {
      continue;
    }
    rows.push({ repo, name, tip, dateRel, subject, isCurrent: head === "*" });
  }
  return rows;
}

/** origin/<default-branch>, e.g. "origin/develop"; falls back to origin/develop. */
async function detectBase(repo: Repo): Promise<string> {
  const head = await tryGit(repo.path, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  return head ? head.trim() : "origin/develop";
}

function firstToken(s: string): string {
  return s.trim().split(/\s+/)[0];
}

/**
 * Fallback merge check when gh is unavailable: does the branch's whole-range diff
 * match the patch-id of some commit already on the base branch (i.e. the squash
 * commit)? Handles clean multi-commit squashes; breaks if the squash was edited.
 */
async function patchIdMerged(repo: Repo, branch: string, base: string): Promise<boolean> {
  const mergeBase = (await tryGit(repo.path, ["merge-base", base, branch]))?.trim();
  if (!mergeBase) {
    return false;
  }
  const branchId = firstToken(await pipeGit(repo.path, ["diff", mergeBase, branch], ["patch-id", "--stable"]));
  if (!branchId) {
    return false;
  }
  const baseIds = await pipeGit(repo.path, ["log", base, "-n", "500", "-p", "--no-color"], ["patch-id", "--stable"]);
  const set = new Set(baseIds.split("\n").map(firstToken).filter(Boolean));
  return set.has(branchId);
}

async function classify(b: RawBranch, headPrs: HeadPrResult, base: string | null): Promise<StaleBranch> {
  const { isCurrent, ...rest } = b;
  if (isCurrent) {
    return { ...rest, verdict: "current", reason: "checked out — can't delete" };
  }

  if (headPrs.available) {
    const merged = pickMerged(headPrs.prs);
    if (merged) {
      // Safe only if the local tip has nothing beyond the merged head — i.e. the
      // tip is an ancestor of (or equal to) the PR's head commit.
      const contained = await tryGit(b.repo.path, ["merge-base", "--is-ancestor", b.tip, merged.headRefOid]);
      const link = { prNumber: merged.number, prUrl: merged.url };
      if (contained !== null) {
        return { ...rest, verdict: "safe", reason: `merged #${merged.number}`, ...link };
      }
      return { ...rest, verdict: "warn", reason: `merged #${merged.number} — local commits beyond merged head`, ...link };
    }
    // No merged PR. Surface a closed/open one for context + linking, if any.
    const latest = pickLatest(headPrs.prs);
    if (latest) {
      return {
        ...rest,
        verdict: "warn",
        reason: `PR #${latest.number} ${latest.state.toLowerCase()} — not merged`,
        prNumber: latest.number,
        prUrl: latest.url,
      };
    }
    return { ...rest, verdict: "warn", reason: "no PR found" };
  }

  // gh unavailable — heuristic fallback.
  if (base) {
    try {
      if (await patchIdMerged(b.repo, b.name, base)) {
        return { ...rest, verdict: "safe", reason: "merged (patch-id, heuristic)" };
      }
    } catch {
      // fall through to unverified
    }
  }
  return { ...rest, verdict: "warn", reason: "unverified (gh unavailable)" };
}

/** Gather + classify all gone branches across the given repos. Does not fetch. */
export async function gatherStale(repos: Repo[]): Promise<StaleBranch[]> {
  const perRepo = await Promise.all(
    repos.map(async (repo) => {
      const gone = await goneBranches(repo);
      if (gone.length === 0) {
        return [];
      }
      const remoteUrl = (await tryGit(repo.path, ["remote", "get-url", "origin"]))?.trim() ?? null;
      const slug = remoteUrl ? parseSlug(remoteUrl) : null;

      const headPrs: HeadPrResult[] = slug
        ? await Promise.all(gone.map((b) => prsForHead(repo.path, slug, b.name)))
        : gone.map(() => ({ available: false, prs: [] }));

      const ghAvailable = headPrs.some((r) => r.available);
      const base = ghAvailable ? null : await detectBase(repo);

      return Promise.all(gone.map((b, i) => classify(b, headPrs[i], base)));
    }),
  );
  return perRepo.flat();
}
