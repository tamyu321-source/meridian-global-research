import { runtimeEnv } from "./server";

type DispatchInput = Record<string, string>;

function config() {
  const env = runtimeEnv();
  const token = env.GITHUB_ACTIONS_TOKEN?.trim();
  const repository = env.GITHUB_REPOSITORY?.trim();
  const workflow = env.GITHUB_WORKFLOW_FILE?.trim() || "full-analysis.yml";
  const ref = env.GITHUB_WORKFLOW_REF?.trim() || "main";
  if (!token || !repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return null;
  return { token, repository, workflow, ref };
}

async function githubFetch(path: string, init: RequestInit = {}) {
  const value = config();
  if (!value) throw new Error("GITHUB_ANALYZER_NOT_CONFIGURED");
  return fetch(`https://api.github.com/repos/${value.repository}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${value.token}`,
      "Content-Type": "application/json",
      "User-Agent": "Meridian-Research-Sites",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
}

export function githubAnalyzerConfigured() { return Boolean(config()); }

export async function dispatchFullAnalysis(inputs: DispatchInput) {
  const value = config();
  if (!value) throw new Error("GITHUB_ANALYZER_NOT_CONFIGURED");
  const workflowPath = `/actions/workflows/${encodeURIComponent(value.workflow)}`;
  const stateResponse = await githubFetch(workflowPath);
  if (!stateResponse.ok) throw new Error(`GITHUB_WORKFLOW_LOOKUP_${stateResponse.status}`);
  const state = await stateResponse.json() as { state?: string };
  if (state.state && state.state !== "active") {
    const enable = await githubFetch(`${workflowPath}/enable`, { method: "PUT" });
    if (!enable.ok && enable.status !== 204) throw new Error(`GITHUB_WORKFLOW_ENABLE_${enable.status}`);
  }
  const response = await githubFetch(`${workflowPath}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: value.ref, inputs }),
  });
  if (!response.ok) throw new Error(`GITHUB_WORKFLOW_DISPATCH_${response.status}`);
  if (response.status === 204) return { runId: null, runUrl: null };
  const body = await response.json().catch(() => ({})) as { workflow_run_id?: number | string; html_url?: string };
  return { runId: body.workflow_run_id ? String(body.workflow_run_id) : null, runUrl: body.html_url ?? null };
}

export async function githubWorkflowState() {
  const value = config();
  if (!value) return { configured: false, state: "unconfigured", repository: null };
  try {
    const response = await githubFetch(`/actions/workflows/${encodeURIComponent(value.workflow)}`);
    if (!response.ok) return { configured: true, state: `error_${response.status}`, repository: value.repository };
    const body = await response.json() as { state?: string; html_url?: string };
    return { configured: true, state: body.state ?? "unknown", repository: value.repository, url: body.html_url ?? null };
  } catch { return { configured: true, state: "unavailable", repository: value.repository }; }
}
