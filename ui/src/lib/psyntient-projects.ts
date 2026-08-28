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

/**
 * Project ids cached from the last load.
 *
 * The sidebar's move-to-group menu is built synchronously while rendering, so
 * it cannot await the projects route. The selector refreshes this cache on
 * load; without it a newly created, still-empty Project would not appear as a
 * move target until a thread already lived in it.
 */
const CACHE_KEY = "psyntient.projectIds";

export type PsyntientProject = {
  projectId: string;
  title: string;
  createdAt?: string | null;
  lastSyncedAt?: string | null;
  dataTypes?: string[];
  archiveEligible?: boolean;
};

/**
 * One entry of the closed data-type vocabulary, served by the projects route.
 *
 * Fetched rather than hardcoded: `daemon/working-memory.mjs`'s DATA_TYPES is
 * the single definition, and it also decides eligibility. A copy here would be
 * a second source of truth for what the Archive accepts.
 */
export type PsyntientDataType = {
  id: string;
  label: string;
  archiveEligible: boolean;
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
  return (await loadProjectsAndTypes(token)).projects;
}

/** Projects plus the data-type vocabulary, in one round trip. */
export async function loadProjectsAndTypes(
  token: string | null,
): Promise<{ projects: PsyntientProject[]; dataTypes: PsyntientDataType[] }> {
  try {
    const res = await fetch(ROUTE, { headers: headers(token) });
    if (!res.ok) {
      return { projects: [], dataTypes: [] };
    }
    const body = (await res.json()) as {
      projects?: PsyntientProject[];
      dataTypes?: PsyntientDataType[];
    };
    const projects = body.projects ?? [];
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(projects.map((p) => p.projectId)));
    } catch {
      // Cache is an optimisation for the synchronous menu; never block on it.
    }
    return { projects, dataTypes: body.dataTypes ?? [] };
  } catch {
    return { projects: [], dataTypes: [] };
  }
}

/**
 * Create a Project. `dataTypes` is required by the route, not optional here.
 *
 * Declaring them at creation IS the Archive-eligibility decision, so there is
 * deliberately no path that creates a Project without it -- an unset project
 * would be silently uncontributable forever, which is what every Project made
 * before this change actually was.
 */
export async function createProject(
  token: string | null,
  title: string,
  dataTypes: string[],
): Promise<{ project: PsyntientProject | null; error?: string }> {
  try {
    const res = await fetch(ROUTE, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ title, dataTypes }),
    });
    const body = (await res.json()) as {
      ok?: boolean;
      project?: PsyntientProject;
      error?: string;
    };
    return body.ok && body.project
      ? { project: body.project }
      : { project: null, error: body.error };
  } catch (err) {
    return { project: null, error: err instanceof Error ? err.message : String(err) };
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

export function readCachedProjectIds(): string[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
