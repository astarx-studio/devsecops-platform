// Read-only GitLab API client for related-repository pairing. Needs the
// worker token to have `read_api` (plus `read_repository` for git fetch).

export function createGitlab({ baseUrl, token, fetchImpl = fetch, timeoutMs = 15000 }) {
  const api = `${String(baseUrl).replace(/\/$/, '')}/api/v4`;
  async function get(pathAndQuery) {
    const res = await fetchImpl(`${api}${pathAndQuery}`, {
      headers: { 'PRIVATE-TOKEN': token },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitLab ${pathAndQuery.split('?')[0]} answered ${res.status}`);
    return res.json();
  }
  const enc = (p) => encodeURIComponent(p);
  return {
    baseUrl: String(baseUrl).replace(/\/$/, ''),
    project: (path) => get(`/projects/${enc(path)}`),
    group: (path) => get(`/groups/${enc(path)}`),
    // Projects in a group and its subgroups, newest activity first.
    groupProjects: async (path, limit = 100) => (await get(`/groups/${enc(path)}/projects?include_subgroups=true&archived=false&simple=true&per_page=${Math.min(limit, 100)}&order_by=last_activity_at`)) ?? [],
    openMrsBySourceBranch: async (projectId, branch) =>
      (await get(`/projects/${projectId}/merge_requests?state=opened&source_branch=${enc(branch)}&order_by=updated_at&per_page=5`)) ?? [],
    openMrsMentioning: async (projectId, text) =>
      (await get(`/projects/${projectId}/merge_requests?state=opened&search=${enc(text)}&in=title,description&order_by=updated_at&per_page=5`)) ?? [],
    // Open MRs with this source branch in every project the token can see.
    openMrsAnywhereBySourceBranch: async (branch) =>
      (await get(`/merge_requests?scope=all&state=opened&source_branch=${enc(branch)}&order_by=updated_at&per_page=20`)) ?? [],
    projectById: (id) => get(`/projects/${Number(id)}`),
    mr: (projectId, iid) => get(`/projects/${projectId}/merge_requests/${iid}`),
    branch: (projectId, name) => get(`/projects/${projectId}/repository/branches/${enc(name)}`),
  };
}
