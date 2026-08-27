// Psyntient Projects: the Slack-channel scope over threads.
//
// A Project is a Vault-backed record in daemon/working-memory.mjs whose
// project_id doubles as the session `category` string. One identifier, two
// representations -- there is deliberately no mapping table.
//
// Backed by /__openclaw__/psyntient/projects (gateway plugin).
//
// Deliberately NOT agents: see PROJECT_AS_AGENT_RESEARCH.md. Memory is shared
// on purpose, sessions already own their context, and the run lock is per
// session file, so parallel work across Projects needs no agent multiplication.

export const DEFAULT_PROJECT_ID = "default";

/** Persisted per browser: which Project the sidebar is scoped to. */
const SELECTED_KEY = "psyntient.selectedProject";

export type PsyntientProject = {
  projectId: string;
  title: string;
  createdAt?: string | null;
  lastSyncedAt?: string | null;
};

const ROUTE = "/__openclaw__/psyntient/projects";

function headers(token: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    h.Authorization = `Bearer ${token}`;
  }
  return h;
}

/** Never throws: a Node without the plugin routes still shows its threads. */
export async function loadProjects(token: string | null): Promise<PsyntientProject[]> {
  try {
    const res = await fetch(ROUTE, { headers: headers(token) });
    if (!res.ok) {
      return [];
    }
    const body = (await res.json()) as { projects?: PsyntientProject[] };
    return body.projects ?? [];
  } catch {
    return [];
  }
}

export async function createProject(
  token: string | null,
  title: string,
): Promise<PsyntientProject | null> {
  try {
    const res = await fetch(ROUTE, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ title }),
    });
    const body = (await res.json()) as { ok?: boolean; project?: PsyntientProject };
    return body.ok && body.project ? body.project : null;
  } catch {
    return null;
  }
}

export type ProjectRemoval = "archive" | "remove" | "delete";

/**
 * Archive / remove / delete a Project.
 *
 * `needsSync` comes back when the working copy has never been synced to the
 * Vault -- eraseProjectWorkingCopy() refuses in that case, and the guard is
 * protecting genuinely unsaved research. Callers should offer to sync rather
 * than surfacing the raw error.
 */
export async function removeProject(
  token: string | null,
  projectId: string,
  action: ProjectRemoval,
): Promise<{ ok: boolean; needsSync?: boolean; error?: string }> {
  try {
    const res = await fetch(ROUTE, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ action, projectId }),
    });
    return (await res.json()) as { ok: boolean; needsSync?: boolean; error?: string };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function readSelectedProjectId(): string {
  try {
    return localStorage.getItem(SELECTED_KEY) || DEFAULT_PROJECT_ID;
  } catch {
    return DEFAULT_PROJECT_ID;
  }
}

export function writeSelectedProjectId(projectId: string): void {
  try {
    localStorage.setItem(SELECTED_KEY, projectId);
  } catch {
    // Scope selection is a convenience; never block on storage.
  }
}
