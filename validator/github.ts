import type { ChangedFile } from "./pathGuard";
import type { RepoInfo } from "./validate";

/**
 * The few GitHub REST calls the validator makes. Every one goes to https://api.github.com and nowhere else, and
 * follows no redirect: there is no URL in here that a submission gets to choose.
 */
const API = "https://api.github.com";
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** The contents API returns a file's bytes inline up to 1 MB. Nothing the validator reads is near that. */
const MAX_INLINE_BYTES = 1024 * 1024;
const MAX_FILE_PAGES = 30;
const MAX_COMMENT_PAGES = 20;
const SHA = /^[0-9a-f]{40}$/;

export interface RemoteFile {
  type: string;
  size: number;
  bytes: Uint8Array;
}

export interface GitHub {
  listPrFiles(repo: string, pr: number): Promise<ChangedFile[]>;
  /** The pull request as GitHub has it NOW: its head commit and how many files it changes. */
  getPr(repo: string, pr: number): Promise<{ headSha: string; changedFiles: number }>;
  /** The commit a branch points at NOW. */
  getBranchHead(repo: string, branch: string): Promise<string>;
  getFile(repo: string, path: string, ref: string): Promise<RemoteFile | null>;
  getRepo(repo: string): Promise<RepoInfo | null>;
  hasCommitsBy(repo: string, login: string): Promise<boolean>;
  upsertComment(repo: string, pr: number, marker: string, body: string): Promise<void>;
}

export function createGitHub(token: string, doFetch: typeof fetch = fetch): GitHub {
  const call = async (method: string, path: string, body?: unknown): Promise<Response> => {
    if (!path.startsWith("/")) throw new Error("not an API path");
    return doFetch(`${API}${path}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "cryptomcp-validator", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const get = async <T>(path: string): Promise<T | null> => {
    const response = await call("GET", path);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    return (await response.json()) as T;
  };
  const checked = (repo: string) => {
    const [owner, name, ...rest] = repo.split("/");
    if (!REPO.test(repo) || rest.length > 0 || [owner, name].some((part) => part === "." || part === "..")) throw new Error("not a repository name");
    return repo;
  };
  const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

  return {
    async listPrFiles(repo, pr) {
      // Every page. The path guard can only refuse what it is shown, so a file on page two must not be invisible
      // to it. GitHub lists at most 3000 files for a pull request; the caller compares the count with the event's.
      const all: ChangedFile[] = [];
      for (let page = 1; page <= MAX_FILE_PAGES; page++) {
        const files = await get<ChangedFile[]>(`/repos/${checked(repo)}/pulls/${pr}/files?per_page=100&page=${page}`);
        if (!files) throw new Error("the pull request could not be read");
        all.push(...files.map((file) => ({ filename: String(file.filename), status: String(file.status), ...(file.previous_filename === undefined ? {} : { previous_filename: String(file.previous_filename) }) })));
        if (files.length < 100) break;
      }
      return all;
    },

    async getPr(repo, pr) {
      const found = await get<{ head?: { sha?: string }; changed_files?: number }>(`/repos/${checked(repo)}/pulls/${pr}`);
      const headSha = String(found?.head?.sha ?? "");
      if (!found || !SHA.test(headSha) || typeof found.changed_files !== "number") throw new Error("the pull request could not be read");
      return { headSha, changedFiles: found.changed_files };
    },

    async getBranchHead(repo, branch) {
      const found = await get<{ object?: { sha?: string } }>(`/repos/${checked(repo)}/git/ref/heads/${encodePath(branch)}`);
      const sha = String(found?.object?.sha ?? "");
      if (!SHA.test(sha)) throw new Error("the base branch could not be resolved");
      return sha;
    },

    async getFile(repo, path, ref) {
      if (!SHA.test(ref)) throw new Error("a file is read at a full commit SHA, never at a branch name");
      const found = await get<{ type?: string; size?: number; content?: string; encoding?: string } | unknown[]>(`/repos/${checked(repo)}/contents/${encodePath(path)}?ref=${ref}`);
      if (found === null) return null;
      if (Array.isArray(found)) return { type: "dir", size: 0, bytes: new Uint8Array() };
      const type = String(found.type ?? "unknown");
      const size = Number(found.size ?? 0);
      // A symlink or a submodule is reported as what it is, and its target is never followed.
      if (type !== "file" || size > MAX_INLINE_BYTES || found.encoding !== "base64" || typeof found.content !== "string") return { type: type === "file" ? "oversized file" : type, size, bytes: new Uint8Array() };
      return { type, size, bytes: new Uint8Array(Buffer.from(found.content, "base64")) };
    },

    async getRepo(repo) {
      const found = await get<{ private?: boolean; template_repository?: { full_name?: string } | null }>(`/repos/${checked(repo)}`);
      return found ? { private: found.private !== false, templateRepository: found.template_repository?.full_name ?? null } : null;
    },

    async hasCommitsBy(repo, login) {
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) return false;
      const commits = await get<unknown[]>(`/repos/${checked(repo)}/commits?author=${encodeURIComponent(login)}&per_page=1`);
      return Array.isArray(commits) && commits.length > 0;
    },

    async upsertComment(repo, pr, marker, body) {
      // Every page, until the report is found. Reading one page would let a hundred comments bury it, and every push
      // would then post another report below the stale ones, some of them green.
      // Only ever edits a comment this workflow wrote: anyone can post one that starts with the marker.
      let mine: { id: number } | undefined;
      for (let page = 1; page <= MAX_COMMENT_PAGES && !mine; page++) {
        const comments = (await get<Array<{ id: number; body?: string; user?: { login?: string } }>>(`/repos/${checked(repo)}/issues/${pr}/comments?per_page=100&page=${page}`)) ?? [];
        mine = comments.find((comment) => comment.user?.login === "github-actions[bot]" && comment.body?.startsWith(marker));
        if (comments.length < 100) break;
      }
      const response = mine ? await call("PATCH", `/repos/${repo}/issues/comments/${mine.id}`, { body }) : await call("POST", `/repos/${repo}/issues/${pr}/comments`, { body });
      if (!response.ok) throw new Error(`GitHub answered ${response.status} to the comment`);
    },
  };
}
