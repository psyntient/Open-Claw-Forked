// Archive sync state: settings, per-project toggles, and run progress.
//
// Backed by /__openclaw__/psyntient/sync (gateway plugin -> daemon/archive-sync.mjs).
//
// A run is started and then POLLED rather than awaited. Submitting a backlog
// takes minutes; holding a request open for it gives the UI nothing to render
// and dies on the first proxy timeout.
const ROUTE = "/__openclaw__/psyntient/sync";

function headers(token: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    h.Authorization = `Bearer ${token}`;
  }
  return h;
}

export type SyncProject = {
  projectId: string;
  title: string;
  dataTypes: string[];
  eligible: boolean;
  contributable: boolean;
  packets: number;
  /** Explicit choice: true / false / null = inherit the Node default. */
  autoSync: boolean | null;
  /** What that resolves to once the global default is applied. */
  autoSyncEffective: boolean;
};

export type SyncRun = {
  projectId: string;
  index: number;
  total: number;
  done: boolean;
  sessionId?: string;
  result?: { submitted?: number; failed?: number; message?: string } | null;
  error?: string | null;
};

export type SyncState = {
  autoSyncAll: boolean;
  projects: SyncProject[];
  active: SyncRun | null;
};

const EMPTY: SyncState = { autoSyncAll: false, projects: [], active: null };

/** Never throws: sync status is ambient chrome and must not break the sidebar. */
export async function loadSyncState(token: string | null): Promise<SyncState> {
  try {
    const res = await fetch(ROUTE, { headers: headers(token) });
    if (!res.ok) {
      return EMPTY;
    }
    const body = (await res.json()) as Partial<SyncState>;
    return {
      autoSyncAll: body.autoSyncAll === true,
      projects: body.projects ?? [],
      active: body.active ?? null,
    };
  } catch {
    return EMPTY;
  }
}

async function post(token: string | null, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(ROUTE, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function setGlobalAutoSync(token: string | null, enabled: boolean): Promise<boolean> {
  return post(token, { action: "set-global", enabled });
}

/** `null` clears the project's explicit choice so it inherits the default again. */
export function setProjectAutoSync(
  token: string | null,
  projectId: string,
  enabled: boolean | null,
): Promise<boolean> {
  return post(token, { action: "set-project", projectId, enabled });
}

export function startSync(token: string | null, projectId: string): Promise<boolean> {
  return post(token, { action: "run", projectId });
}
