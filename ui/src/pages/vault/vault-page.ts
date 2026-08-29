// The Vault viewer: everything this Node holds, and what could leave it.
//
// WHY BROWSE-FIRST, WHERE THE ARCHIVE VIEWER IS SEARCH-FIRST
// The Archive is someone else's corpus, named in a vocabulary the researcher
// has never seen, so search is the only entry point that works there. The
// Vault inverts that: they made it. What they do not know is not what is in it
// but the STATE of it -- which projects hold real captures, which are eligible
// to contribute, which already went to the Archive.
//
// And the Vault has an authority the Archive does not: it is where the user
// decides what leaves their machine. A view whose primary mode is "type a
// query, get a subset" answers "find me X" well and "show me everything, so I
// can be sure nothing is leaving that should not" badly -- and the second is
// the question a consent surface exists to answer. So the full inventory is
// the ground state and search NARROWS it, rather than search producing the
// list. A user cannot get stranded in a result set that was never a mode.
//
// WHY THE CARDS ARE NOT UNIFORM
// A project holding three years of EEG and a project holding four notes are
// not the same object. Every card keeps the same spine -- title, device, sync
// state, eligibility -- because those are what you compare across projects and
// what governs consent, so they must line up for scanning. The body renders
// what the project actually is: captures get a data strip, written work gets a
// preview, empty projects say so rather than showing a blank.
//
// SCALE
// A Vault is not small. Years of capture is tens of thousands of files, so the
// ledger this reads is summary-first and its per-file sample is capped; the
// full contents of one project are pulled only when that project is opened.
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { icons, type IconName } from "../../components/icons.ts";
import { t } from "../../i18n/index.ts";
import { writeSelectedProjectId } from "../../lib/psyntient-projects.ts";
import { handOffPrompt } from "../../lib/psyntient-prompt-handoff.ts";

type Sessions = {
  files: number;
  bytes: number;
  packets: number;
  nonPacketFiles: number;
  formats?: Array<{ ext: string; n: number }>;
  span?: { oldest: string; newest: string } | null;
};

type Project = {
  device: string;
  projectId: string;
  title: string;
  description?: string | null;
  dataTypes: string[];
  declaredEligible: boolean;
  hasCaptures: boolean;
  contributable: boolean;
  sessions: Sessions;
  material?: Record<string, number>;
  path: string;
  createdAt?: string | null;
  lastSyncedAt: string | null;
  autoSync: boolean | null;
  autoSyncEffective?: boolean;
  submissions: number;
};

type Ledger = {
  ok: boolean;
  error?: string;
  scannedAt?: string;
  vaultRoot?: string | null;
  storage?: string;
  counts?: {
    projects: number;
    contributable: number;
    captureFiles: number;
    captureBytes: number;
    packets: number;
  };
  projects?: Project[];
};

type AreaEntry = {
  path: string;
  ext: string;
  bytes: number;
  mtime: string;
  kind: "file" | "packet" | "text" | "data" | "binary";
  text?: string;
  truncated?: boolean;
  packet?: {
    sessionId: string | null;
    timestamp: string | null;
    durationSeconds: number | null;
    modalities: unknown;
    consentState: string | null;
    hasReport: boolean;
    contextTags: unknown;
  };
};

type Area = {
  area: string;
  total: number;
  listed: number;
  truncated: boolean;
  entries: AreaEntry[];
};

type Detail = { ok: boolean; error?: string; project?: Project; areas?: Area[] };

const LEDGER_ROUTE = "/__openclaw__/psyntient/vault-ledger";
const SEARCH_ROUTE = "/__openclaw__/psyntient/vault/search";
const PROJECT_ROUTE = "/__openclaw__/psyntient/vault/project";
const DOWNLOAD_ROUTE = "/__openclaw__/psyntient/vault/download";

function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

/**
 * What a project mostly is, which decides how its card body renders.
 *
 * Captures win over written material when both are present: a project with
 * 4,000 recordings and one note is a recording project, and showing the note
 * as its headline would misrepresent it.
 */
/** Whole days since a date, floored at 1 so a project made today reads as a
 *  duration rather than as "0 days". */
function daysSince(iso: string): number {
  return Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/** Category icons, so the four areas are distinguishable at a glance. */
function areaIcon(area: string): IconName {
  if (area === "sessions") return "activity";
  if (area === "notes") return "fileText";
  if (area === "analyses") return "barChart";
  return "archive";
}

/** File-type icons. Unknown types get a neutral document rather than a guess. */
function fileIcon(e: { ext: string; kind?: string }): IconName {
  if (e.kind === "packet") return "brain";
  switch (e.ext) {
    case ".md":
    case ".txt":
      return "fileText";
    case ".csv":
      return "barChart";
    case ".json":
      return "database";
    case ".pdf":
      return "book";
    default:
      return "scrollText";
  }
}

function shapeOf(p: Project): "captures" | "written" | "empty" {
  if (p.sessions.files > 0) return "captures";
  const written = Object.values(p.material ?? {}).reduce((n, v) => n + v, 0);
  return written > 0 ? "written" : "empty";
}

@customElement("psyntient-vault-page")
export class PsyntientVaultPage extends LitElement {
  // Light DOM: inherits the app's stylesheet instead of re-declaring tokens.
  override createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) authToken: string | null = null;

  @state() private ledger: Ledger | null = null;
  @state() private loading = true;
  @state() private errorText: string | null = null;

  @state() private query = "";
  @state() private searching = false;
  @state() private searchStage: string | null = null;
  @state() private searchProgress = 0;
  /** Project ids the last search matched, in rank order. Null = not filtered. */
  @state() private matchedIds: string[] | null = null;
  @state() private searchedFor = "";

  @state() private selected: Project | null = null;
  @state() private detail: Detail | null = null;
  @state() private detailLoading = false;

  private progressTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Generation counter for loads, so a superseded response cannot overwrite a
   * newer one. Without it the tokenless first attempt and the retry race, and
   * whichever resolves last wins -- which showed a 401 error over a Vault that
   * had already loaded correctly.
   */
  private loadSeq = 0;
  /** A `?project=` that matched nothing in the ledger. */
  @state() private missingProject: string | null = null;
  /** File browser state. */
  @state() private browsing = false;
  @state() private openFile: AreaEntry | null = null;
  @state() private openArea: string | null = null;
  @state() private downloading = false;
  /** Collapsed accordion nodes. Empty means everything is open. */
  @state() private collapsed = new Set<string>();

  override connectedCallback() {
    super.connectedCallback();
    // ALWAYS attempt, even with no token yet.
    //
    // This used to skip the fetch until a token arrived, to avoid one
    // unauthenticated 401 per visit. That traded a wasted request for a much
    // worse failure: when the token never arrives -- a browser whose stored
    // device identity was cleared -- load() never ran, `loading` never
    // cleared, and the page sat on "Reading the Vault..." forever with no
    // explanation. Observed exactly that.
    //
    // The race that motivated the skip (a late 401 overwriting a good result)
    // is handled properly by the generation counter in load(), so attempting
    // always is now safe as well as more honest.
    void this.load();
  }

  /**
   * Re-run the first load once the token actually arrives.
   *
   * `connectedCallback` fires before Lit commits `authToken`, so the very
   * first fetch goes out with no Authorization header and comes back 401 --
   * which rendered as "the Vault is unreachable" on a Vault that was fine. The
   * `!this.ledger` guard keeps this to a genuine retry rather than a refetch
   * on every token change.
   */
  override updated(changed: Map<string, unknown>) {
    if (changed.has("authToken") && this.authToken && !this.ledger) {
      void this.load();
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  private headers(): HeadersInit {
    return this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {};
  }

  private async load() {
    const seq = ++this.loadSeq;
    const current = () => seq === this.loadSeq;

    this.loading = true;
    this.errorText = null;
    try {
      const res = await fetch(LEDGER_ROUTE, { headers: this.headers() });
      if (!current()) return;
      if (!res.ok) {
        // 401 is not a fault in the Vault; it means this browser has no
        // gateway identity -- typically after site data was cleared. Say what
        // to do rather than showing a status code the user cannot act on.
        this.errorText =
          res.status === 401
            ? t("vault.notConnected")
            : t("vault.requestFailed", { status: String(res.status) });
        return;
      }
      const body = (await res.json()) as Ledger;
      if (!current()) return;
      if (!body.ok) {
        this.errorText = body.error ?? t("vault.requestFailed", { status: "?" });
        return;
      }
      this.ledger = body;
      this.openRequestedProject();
    } catch (err) {
      if (current()) this.errorText = err instanceof Error ? err.message : String(err);
    } finally {
      if (current()) this.loading = false;
    }
  }

  /**
   * Honour `?project=<id>`, so the sidebar's project-files button lands on the
   * project you were working in rather than on the full inventory.
   *
   * Runs once per load and only when nothing is open yet: a later ledger
   * refresh must not yank the panel back to the URL's project after the user
   * has clicked elsewhere.
   */
  private openRequestedProject() {
    if (this.selected) return;
    const wanted = new URLSearchParams(window.location.search).get("project");
    if (!wanted) return;
    const match = (this.ledger?.projects ?? []).find((p) => p.projectId === wanted);
    if (match) {
      void this.open(match);
      return;
    }
    // Landing on the full list with no explanation reads as a broken button. A
    // Project can exist in the app and not in the Vault, so this is a real
    // state and it has to say so.
    this.missingProject = wanted;
  }

  /**
   * Search narrows the inventory rather than replacing it.
   *
   * The stage labels are real and come off the stream; the motion between them
   * is not pretending to be fractional progress. The match step is one opaque
   * model call that cannot report from inside itself, so the bar eases toward a
   * ceiling it only reaches when the result actually lands.
   */
  private async runSearch() {
    const q = this.query.trim();
    if (!q || this.searching) return;

    this.searching = true;
    this.searchProgress = 0;
    this.searchStage = t("vault.stageStarting");
    this.searchedFor = q;

    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = setInterval(() => {
      // Asymptotic: always moving, never arriving, so a slow stage reads as
      // slow rather than as a stall.
      this.searchProgress = Math.min(
        0.92,
        this.searchProgress + (0.92 - this.searchProgress) * 0.06,
      );
    }, 220);

    try {
      const res = await fetch(`${SEARCH_ROUTE}?query=${encodeURIComponent(q)}`, {
        headers: this.headers(),
      });
      if (!res.ok || !res.body) {
        this.errorText = t("vault.searchFailed");
        return;
      }

      // fetch + reader rather than EventSource: EventSource cannot set an
      // Authorization header, and this route needs the gateway bearer token.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          let name = "";
          let raw = "";
          for (const line of frame.split("\n")) {
            if (line.startsWith("event: ")) name = line.slice(7).trim();
            else if (line.startsWith("data: ")) raw += line.slice(6);
          }
          if (!raw) continue;
          const payload = JSON.parse(raw);

          if (name === "stage") {
            this.searchStage = t(`vault.stage.${payload.stage}`, {
              detail: payload.detail ?? "",
            });
          } else if (name === "result") {
            if (!payload.ok) {
              this.errorText = payload.error ?? t("vault.searchFailed");
              this.matchedIds = null;
            } else {
              this.matchedIds = (payload.projects ?? []).map((p: Project) => p.projectId);
            }
            this.searchProgress = 1;
          }
        }
      }
    } catch (err) {
      this.errorText = err instanceof Error ? err.message : String(err);
    } finally {
      if (this.progressTimer) clearInterval(this.progressTimer);
      this.progressTimer = null;
      this.searching = false;
      this.searchStage = null;
    }
  }

  private clearSearch() {
    this.matchedIds = null;
    this.searchedFor = "";
    this.query = "";
    this.errorText = null;
  }

  /** The inventory, narrowed by a search when one is active. */
  private visibleProjects(): Project[] {
    const all = this.ledger?.projects ?? [];
    if (!this.matchedIds) return all;
    const rank = new Map(this.matchedIds.map((id, i) => [id, i]));
    return all
      .filter((p) => rank.has(p.projectId))
      .sort((a, b) => (rank.get(a.projectId) ?? 0) - (rank.get(b.projectId) ?? 0));
  }

  private async open(p: Project) {
    this.selected = p;
    // Stacked layouts swap the grid for the panel, so the page must return to
    // the top or the reader lands mid-panel with no idea what changed.
    if (window.matchMedia("(max-width: 60rem)").matches) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    this.detail = null;
    this.detailLoading = true;
    try {
      const url = `${PROJECT_ROUTE}?project=${encodeURIComponent(p.projectId)}&device=${encodeURIComponent(p.device)}`;
      const res = await fetch(url, { headers: this.headers() });
      this.detail = (await res.json()) as Detail;
    } catch (err) {
      this.detail = { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.detailLoading = false;
    }
  }

  private close() {
    this.selected = null;
    this.detail = null;
  }

  /**
   * Hand off to the chat side of this Project, using the Project selector's own
   * plumbing so the two cannot drift: write the selection, then land on "/new".
   *
   * "/new" rather than "/" or "/sessions" for the reason the selector already
   * documents -- Home opens the main session, which belongs to the Default
   * Project, so any other Project would land on a General thread. The new-thread
   * draft belongs to no Project until sent, which also gives a Project with no
   * threads yet somewhere to start.
   */
  private openInApp(p: Project) {
    writeSelectedProjectId(p.projectId);
    window.location.href = "/new";
  }

  /**
   * Open the file browser.
   *
   * A pane rather than an inline expansion: the profile panel is 24rem wide,
   * and the point is to scroll THROUGH a project's files, which a panel that
   * grows downward forever does badly.
   */
  private browse() {
    this.browsing = true;
    const first = (this.detail?.areas ?? []).find((a) => a.entries.length > 0);
    const entry = first?.entries[0];
    // Select something immediately: an empty right-hand pane on open reads as
    // broken rather than ready.
    if (first && entry) {
      this.openArea = first.area;
      this.openFile = entry;
    }
  }

  private closeBrowser() {
    this.browsing = false;
    this.openFile = null;
    this.openArea = null;
  }

  /** Collapse or expand one accordion node. */
  private toggleNode(key: string) {
    const next = new Set(this.collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.collapsed = next;
  }

  private async download(p: Project, area: string, entry: AreaEntry) {
    this.downloading = true;
    try {
      const url =
        `${DOWNLOAD_ROUTE}?project=${encodeURIComponent(p.projectId)}` +
        `&device=${encodeURIComponent(p.device)}` +
        `&path=${encodeURIComponent(`${area}/${entry.path}`)}`;
      // fetch + blob rather than a plain <a href>: this route needs the gateway
      // bearer token, and a token in a URL ends up in history and logs.
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) {
        this.errorText = t("vault.downloadFailed", { status: String(res.status) });
        return;
      }
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = href;
      a.download = entry.path.split("/").pop() ?? "file";
      a.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      this.errorText = err instanceof Error ? err.message : String(err);
    } finally {
      this.downloading = false;
    }
  }

  private renderAccordion(key: string, head: unknown, body: unknown) {
    const open = !this.collapsed.has(key);
    return html`
      <div class="psy-vault__acc ${open ? "psy-vault__acc--open" : ""}">
        <button
          type="button"
          class="psy-vault__acc-head"
          aria-expanded=${String(open)}
          @click=${() => this.toggleNode(key)}
        >
          ${head}
          <span class="psy-vault__acc-chevron" aria-hidden="true">${icons.chevronDown}</span>
        </button>
        <div class="psy-vault__acc-body"><div>${body}</div></div>
      </div>
    `;
  }

  private renderFileTile(area: string, e: AreaEntry) {
    const active = this.openFile?.path === e.path && this.openArea === area;
    return html`
      <li>
        <button
          type="button"
          class="psy-vault__tile ${active ? "psy-vault__tile--active" : ""}"
          @click=${() => {
            this.openFile = e;
            this.openArea = area;
          }}
        >
          <span class="psy-vault__tile-icon" aria-hidden="true">${icons[fileIcon(e)]}</span>
          <span class="psy-vault__tile-name">${e.path}</span>
          <span class="psy-vault__tile-size">${formatBytes(e.bytes)}</span>
        </button>
      </li>
    `;
  }

  /**
   * Categories, then file types, then files -- the shape the Vault actually
   * has on disk, so what a researcher sees here and what they would find in
   * the directory match.
   *
   * Everything starts EXPANDED. Collapsing is for taming a large project once
   * you know what is in it; starting collapsed would hide the very thing the
   * pane was opened to show.
   */
  private renderBrowser(p: Project) {
    const areas = (this.detail?.areas ?? []).filter((a) => a.entries.length > 0);
    return html`
      <div class="psy-vault__browser" role="dialog" aria-label=${t("vault.browseFiles")}>
        <header class="psy-vault__browser-head">
          <div>
            <p class="psy-vault__kicker">${p.title}</p>
            <h3>${t("vault.browseFiles")}</h3>
          </div>
          <button type="button" class="psy-vault__close" @click=${() => this.closeBrowser()}>
            ${t("vault.close")}
          </button>
        </header>

        <div class="psy-vault__browser-body">
          <nav class="psy-vault__tree" aria-label=${t("vault.browseFiles")}>
            ${areas.map((a) => {
              const byType = new Map<string, AreaEntry[]>();
              for (const e of a.entries) {
                const key = e.ext || "(none)";
                byType.set(key, [...(byType.get(key) ?? []), e]);
              }
              return this.renderAccordion(
                a.area,
                html`<span class="psy-vault__acc-icon" aria-hidden="true"
                    >${icons[areaIcon(a.area)]}</span
                  >
                  <span class="psy-vault__acc-label">${t(`vault.material.${a.area}`)}</span>
                  <span class="psy-vault__acc-count">${a.total}</span>`,
                [...byType.entries()].map(([ext, entries]) =>
                  this.renderAccordion(
                    `${a.area}:${ext}`,
                    html`<span class="psy-vault__acc-ext">${ext}</span>
                      <span class="psy-vault__acc-count">${entries.length}</span>`,
                    html`<ul class="psy-vault__tiles">
                      ${entries.map((e) => this.renderFileTile(a.area, e))}
                    </ul>`,
                  ),
                ),
              );
            })}
          </nav>

          <section class="psy-vault__filepane">
            ${this.openFile && this.openArea
              ? html`
                  <div class="psy-vault__file-card">
                    <span class="psy-vault__file-icon" aria-hidden="true"
                      >${icons[fileIcon(this.openFile)]}</span
                    >
                    <h4>${this.openFile.path}</h4>
                    <dl class="psy-vault__fields">
                      <div>
                        <dt>${t("vault.fileCategory")}</dt>
                        <dd>${t(`vault.material.${this.openArea}`)}</dd>
                      </div>
                      <div>
                        <dt>${t("vault.fileType")}</dt>
                        <dd>${this.openFile.ext || "\u2014"}</dd>
                      </div>
                      <div>
                        <dt>${t("vault.size")}</dt>
                        <dd>${formatBytes(this.openFile.bytes)}</dd>
                      </div>
                      <div>
                        <dt>${t("vault.modified")}</dt>
                        <dd>${formatDate(this.openFile.mtime)}</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      class="psy-vault__open"
                      ?disabled=${this.downloading}
                      @click=${() =>
                        void this.download(p, this.openArea ?? "", this.openFile as AreaEntry)}
                    >
                      ${this.downloading ? t("vault.downloading") : t("vault.download")}
                    </button>
                    <p class="psy-vault__more">${t("vault.previewLater")}</p>
                  </div>
                `
              : html`<p class="psy-vault__empty-note">${t("vault.pickFile")}</p>`}
          </section>
        </div>
      </div>
    `;
  }

  /** One-click stepping through the visible set, same as the Archive viewer. */
  private step(delta: number) {
    const list = this.visibleProjects();
    if (list.length === 0) return;
    const current = list.findIndex(
      (x) => x.projectId === this.selected?.projectId && x.device === this.selected?.device,
    );
    const next = current === -1 ? 0 : (current + delta + list.length) % list.length;
    const target = list[next];
    if (target) void this.open(target);
  }

  private renderStat(label: string, value: string | number) {
    return html`<div class="psy-vault__stat">
      <span class="psy-vault__stat-value">${value}</span>
      <span class="psy-vault__stat-label">${label}</span>
    </div>`;
  }

  /**
   * The consent line: whether this project could contribute, and why not when
   * it cannot. "Eligible but empty" and "has data but declares none" are
   * different problems with different fixes, so they read differently.
   */
  private renderEligibility(p: Project) {
    if (p.contributable) {
      return html`<span class="psy-vault__badge psy-vault__badge--ready"
        >${t("vault.contributable")}</span
      >`;
    }
    if (p.declaredEligible) {
      return html`<span class="psy-vault__badge">${t("vault.noPacketsYet")}</span>`;
    }
    return html`<span class="psy-vault__badge psy-vault__badge--quiet"
      >${t("vault.notEligible")}</span
    >`;
  }

  /** Collapsed to one date when a project's captures all landed the same day,
   *  which is the common case early on and reads as a bug rendered as a range. */
  private renderSpan(span: { oldest: string; newest: string }) {
    const from = formatDate(span.oldest);
    const to = formatDate(span.newest);
    return from === to ? from : t("vault.span", { from, to });
  }

  private renderCardBody(p: Project) {
    const shape = shapeOf(p);

    if (shape === "captures") {
      const formats = (p.sessions.formats ?? []).slice(0, 3);
      return html`
        <div class="psy-vault__strip">
          ${this.renderStat(t("vault.captures"), p.sessions.files)}
          ${this.renderStat(t("vault.packets"), p.sessions.packets)}
          ${this.renderStat(t("vault.size"), formatBytes(p.sessions.bytes))}
        </div>
        ${formats.length
          ? html`<p class="psy-vault__formats">
              ${formats.map((f) => html`<span class="psy-vault__format">${f.ext} ×${f.n}</span>`)}
            </p>`
          : nothing}
        ${p.sessions.span
          ? html`<p class="psy-vault__span">${this.renderSpan(p.sessions.span)}</p>`
          : nothing}
      `;
    }

    if (shape === "written") {
      const material = Object.entries(p.material ?? {}).filter(([, n]) => n > 0);
      return html`
        <div class="psy-vault__strip">
          ${material.map(([kind, n]) => this.renderStat(t(`vault.material.${kind}`), n))}
        </div>
        ${p.description ? html`<p class="psy-vault__desc">${p.description}</p>` : nothing}
      `;
    }

    return html`<p class="psy-vault__empty-note">${t("vault.projectEmpty")}</p>`;
  }

  private renderCard(p: Project) {
    return html`
      <button
        type="button"
        class="psy-vault__card psy-vault__card--${shapeOf(p)}"
        @click=${() => void this.open(p)}
      >
        <header class="psy-vault__card-head">
          <h3 class="psy-vault__card-title">${p.title}</h3>
          <span class="psy-vault__device">${p.device}</span>
        </header>
        ${this.renderCardBody(p)}
        <footer class="psy-vault__card-foot">
          ${this.renderEligibility(p)}
          ${p.lastSyncedAt
            ? html`<span class="psy-vault__synced"
                >${t("vault.lastSynced", { date: formatDate(p.lastSyncedAt) })}</span
              >`
            : nothing}
          ${p.submissions > 0
            ? html`<span class="psy-vault__submissions"
                >${t("vault.submissions", { count: String(p.submissions) })}</span
              >`
            : nothing}
        </footer>
      </button>
    `;
  }

  private renderDetail(p: Project) {
    const areas = (this.detail?.areas ?? []).filter((a) => a.total > 0);
    const list = this.visibleProjects();
    const index = list.findIndex((x) => x.projectId === p.projectId && x.device === p.device);

    return html`
      <aside class="psy-vault__detail" aria-label=${p.title}>
        <header class="psy-vault__detail-head">
          <div class="psy-vault__stepper">
            <button type="button" title=${t("vault.previous")} @click=${() => this.step(-1)}>
              ‹
            </button>
            <span
              >${t("vault.position", {
                index: String(index + 1),
                total: String(list.length),
              })}</span
            >
            <button type="button" title=${t("vault.next")} @click=${() => this.step(1)}>›</button>
          </div>
          <button type="button" class="psy-vault__close" @click=${() => this.close()}>
            ${t("vault.close")}
          </button>
        </header>

        <p class="psy-vault__kicker">${t("vault.profileLabel")}</p>
        <h2 class="psy-vault__detail-title">${p.title}</h2>
        <p class="psy-vault__detail-desc ${p.description ? "" : "psy-vault__detail-desc--empty"}">
          ${p.description?.trim() || t("vault.noDescription")}
        </p>
        ${p.createdAt
          ? html`<p class="psy-vault__detail-meta">
              ${t("vault.started", { date: formatDate(p.createdAt) })} ·
              ${daysSince(p.createdAt) === 1
                ? t("vault.ageOne")
                : t("vault.age", { days: String(daysSince(p.createdAt)) })}
            </p>`
          : nothing}
        <p class="psy-vault__detail-path">${p.path}</p>
        ${p.dataTypes.length
          ? html`<p class="psy-vault__types">
              ${p.dataTypes.map((d) => html`<span class="psy-vault__type">${d}</span>`)}
            </p>`
          : nothing}
        ${this.detailLoading
          ? html`<p class="psy-vault__loading">${t("vault.opening")}</p>`
          : this.detail && !this.detail.ok
            ? html`<p class="psy-vault__error">${this.detail.error}</p>`
            : areas.length === 0
              ? html`<p class="psy-vault__empty-note">${t("vault.projectEmpty")}</p>`
              : html`
                  <!-- A summary, not a listing. Exploring files is the file
                       browser's job, and dumping note text inline here was
                       left over from before that existed: it made the profile
                       scroll for pages and buried the identity and consent
                       information the profile is actually for. -->
                  <ul class="psy-vault__summary-list">
                    ${areas.map(
                      (a) => html`
                        <li>
                          <span class="psy-vault__summary-icon" aria-hidden="true"
                            >${icons[areaIcon(a.area)]}</span
                          >
                          <span class="psy-vault__summary-label"
                            >${t(`vault.material.${a.area}`)}</span
                          >
                          <span class="psy-vault__summary-count">${a.total}</span>
                        </li>
                      `,
                    )}
                  </ul>
                `}

        <div class="psy-vault__actions">
          <button type="button" class="psy-vault__open" @click=${() => this.browse()}>
            ${t("vault.browseFiles")}
          </button>
          <button type="button" class="psy-vault__open" @click=${() => this.openInApp(p)}>
            ${t("vault.openInApp")}
          </button>
          <button
            type="button"
            class="psy-vault__ask"
            @click=${() =>
              handOffPrompt(t("vault.askCortexPrompt", { title: p.title, id: p.projectId }))}
          >
            ${t("vault.askCortex")}
          </button>
        </div>
      </aside>
    `;
  }

  override render() {
    if (this.loading) {
      return html`<div class="psy-vault">
        <p class="psy-vault__loading">${t("vault.loading")}</p>
      </div>`;
    }

    const counts = this.ledger?.counts;
    const projects = this.visibleProjects();

    return html`
      <div class="psy-vault">
        <header class="psy-vault__head">
          <h1>${t("vault.title")}</h1>
          <p class="psy-vault__subtitle">${t("vault.subtitle")}</p>
          ${counts
            ? html`<div class="psy-vault__totals">
                ${this.renderStat(t("vault.projects"), counts.projects)}
                ${this.renderStat(t("vault.captures"), counts.captureFiles)}
                ${this.renderStat(t("vault.size"), formatBytes(counts.captureBytes))}
                ${this.renderStat(t("vault.contributableCount"), counts.contributable)}
              </div>`
            : nothing}
          ${this.ledger?.vaultRoot
            ? html`<p class="psy-vault__root" title=${this.ledger.vaultRoot}>
                ${t("vault.storedAt", {
                  storage: this.ledger.storage ?? "local",
                  path: this.ledger.vaultRoot,
                })}
              </p>`
            : nothing}
        </header>

        <div class="psy-vault__search">
          <input
            type="search"
            .value=${this.query}
            placeholder=${t("vault.searchPlaceholder")}
            @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") void this.runSearch();
            }}
          />
          <button type="button" @click=${() => void this.runSearch()} ?disabled=${this.searching}>
            ${t("vault.search")}
          </button>
          ${this.matchedIds
            ? html`<button
                type="button"
                class="psy-vault__clear"
                @click=${() => this.clearSearch()}
              >
                ${t("vault.clearSearch")}
              </button>`
            : nothing}
        </div>

        ${this.searching
          ? html`<div class="psy-vault__progress" role="status" aria-live="polite">
              <div class="psy-vault__progress-track">
                <div
                  class="psy-vault__progress-fill"
                  style=${`width:${Math.round(this.searchProgress * 100)}%`}
                ></div>
              </div>
              <p class="psy-vault__progress-label">${this.searchStage}</p>
            </div>`
          : nothing}
        ${this.errorText ? html`<p class="psy-vault__error">${this.errorText}</p>` : nothing}
        ${this.missingProject
          ? html`<p class="psy-vault__notice">
              ${t("vault.deepLinkMissing", { id: this.missingProject })}
            </p>`
          : nothing}
        ${this.matchedIds
          ? html`<p class="psy-vault__result-count">
              ${projects.length === 0
                ? t("vault.noResults", { query: this.searchedFor })
                : t("vault.resultCount", { count: String(projects.length) })}
            </p>`
          : nothing}

        <div class="psy-vault__body ${this.selected ? "psy-vault__body--detail" : ""}">
          <div class="psy-vault__grid">
            ${projects.length === 0 && !this.matchedIds
              ? html`<p class="psy-vault__empty-note">${t("vault.vaultEmpty")}</p>`
              : projects.map((p) => this.renderCard(p))}
          </div>
          ${this.selected ? this.renderDetail(this.selected) : nothing}
        </div>
        ${this.browsing && this.selected ? this.renderBrowser(this.selected) : nothing}
      </div>
    `;
  }
}
