import { execFile, spawn } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 20 * 1024 * 1024;

/** Run `git <args>` in cwd; rejects on non-zero exit. */
export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: MAX_BUFFER });
  return stdout;
}

/** Run `git <args>`; resolve stdout on success, null on any failure (incl. non-zero exit). */
export async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

/** Run `gh <args>` in cwd; rejects on non-zero exit or if gh is missing. */
export async function gh(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("gh", args, { cwd, maxBuffer: MAX_BUFFER });
  return stdout;
}

/** Run `git <args1> | git <args2>` and resolve the second command's stdout. */
export function pipeGit(cwd: string, args1: string[], args2: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p1 = spawn("git", args1, { cwd });
    const p2 = spawn("git", args2, { cwd });
    let out = "";
    let err = "";
    p1.on("error", reject);
    p2.on("error", reject);
    p1.stdout!.pipe(p2.stdin!);
    p1.stderr!.on("data", (d) => (err += d));
    p2.stdout!.on("data", (d) => (out += d));
    p2.stderr!.on("data", (d) => (err += d));
    p2.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(err || `git exited ${code}`))));
  });
}
