import { hash } from "./core.js";
export async function publish(
  runId: string,
  recipe: string,
  before: Record<string, string>,
  after: Record<string, string>,
  signal: AbortSignal,
) {
  const repo = process.env.REPOSHIFT_GITHUB_REPOSITORY,
    token = process.env.GITHUB_TOKEN;
  if (!repo || !/^[-\w.]+\/[-\w.]+$/.test(repo) || !token)
    throw new Error(
      "Configure an authorized GitHub repository and token before publishing",
    );
  async function api(route: string, method = "GET", body?: unknown) {
    signal.throwIfAborted();
    const r = await fetch(`https://api.github.com/repos/${repo}${route}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`GitHub ${method} ${route}: ${r.status}`);
    return r.json() as Promise<any>;
  }
  const branch = `reposhift/${runId}`;
  const existing = await api(
    `/pulls?state=all&head=${encodeURIComponent(repo.split("/")[0] + ":" + branch)}`,
  );
  if (existing.length) return existing[0].html_url as string;
  const repository = await api("");
  const baseBranch = repository.default_branch;
  const base = await api(`/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  const commit = await api(`/git/commits/${base.object.sha}`);
  // Publication is restricted to an exact fixture source snapshot on the remote base.
  for (const [file, content] of Object.entries(before)) {
    const remote = await api(`/contents/${file}?ref=${base.object.sha}`);
    if (
      remote.encoding !== "base64" ||
      hash(Buffer.from(remote.content, "base64")) !== hash(content)
    )
      throw new Error(
        "Remote base differs from verified fixture; refusing publication",
      );
  }
  const tree = await api("/git/trees", "POST", {
    base_tree: commit.tree.sha,
    tree: Object.entries(after)
      .filter(([file, content]) => before[file] !== content)
      .map(([path, content]) => ({
        path,
        mode: "100644",
        type: "blob",
        content,
      })),
  });
  let remoteBranch: any;
  try {
    remoteBranch = await api(`/git/ref/heads/${encodeURIComponent(branch)}`);
  } catch (e) {
    if (!String(e).endsWith(": 404")) throw e;
  }
  if (remoteBranch) {
    const remoteCommit = await api(`/git/commits/${remoteBranch.object.sha}`);
    if (remoteCommit.tree.sha !== tree.sha)
      throw new Error(
        "Existing publication branch differs from verified patch",
      );
  } else {
    const created = await api("/git/commits", "POST", {
      message: `RepoShift: ${recipe}\n\nRun: ${runId}`,
      tree: tree.sha,
      parents: [base.object.sha],
    });
    await api("/git/refs", "POST", {
      ref: `refs/heads/${branch}`,
      sha: created.sha,
    });
  }
  // Reconcile after a previous ambiguous create response before issuing another write.
  const found = await api(
    `/pulls?state=all&head=${encodeURIComponent(repo.split("/")[0] + ":" + branch)}`,
  );
  if (found.length) return found[0].html_url as string;
  const pr = await api("/pulls", "POST", {
    title: `RepoShift: ${recipe}`,
    head: branch,
    base: baseBranch,
    draft: true,
    body: `Verified migration for run ${runId}.\n\nBuild, visible tests, hidden tests, migration assertions and forbidden-file checks passed.\n\nThis development-fixture run is not a held-out benchmark result.\n\n<!-- reposhift:${runId} -->`,
  });
  return pr.html_url as string;
}
