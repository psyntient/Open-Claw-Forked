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
import { t } from "../../i18n/index.ts";
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

  override connectedCallback() {
    super.connectedCallback();
    void this.load();
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
    this.loading = true;
    this.errorText = null;
    try {
      const res = await fetch(LEDGER_ROUTE, { headers: this.headers() });
      if (!res.ok) {
        this.errorText = t("vault.requestFailed", { status: String(res.status) });
        return;
      }
      const body = (await res.json()) as Ledger;
      if (!body.ok) {
        this.errorText = body.error ?? t("vault.requestFailed", { status: "?" });
        return;
      }
      this.ledger = body;
    } catch (err) {
      this.errorText = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
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

  private renderEntry(e: AreaEntry) {
    if (e.kind === "packet" && e.packet) {
      return html`<li class="psy-vault__entry psy-vault__entry--packet">
        <span class="psy-vault__entry-path">${e.path}</span>
        <span class="psy-vault__entry-meta">
          ${e.packet.timestamp ? formatDate(e.packet.timestamp) : ""}
          ${e.packet.durationSeconds
            ? html` · ${t("vault.duration", { s: String(e.packet.durationSeconds) })}`
            : nothing}
          ${e.packet.consentState ? html` · ${e.packet.consentState}` : nothing}
        </span>
      </li>`;
    }
    if (e.kind === "text" && e.text) {
      return html`<li class="psy-vault__entry psy-vault__entry--text">
        <span class="psy-vault__entry-path">${e.path}</span>
        <pre class="psy-vault__text">${e.text}</pre>
        ${e.truncated
          ? html`<span class="psy-vault__more">${t("vault.truncated")}</span>`
          : nothing}
      </li>`;
    }
    return html`<li class="psy-vault__entry">
      <span class="psy-vault__entry-path">${e.path}</span>
      <span class="psy-vault__entry-meta">${formatBytes(e.bytes)}</span>
    </li>`;
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

        <h2 class="psy-vault__detail-title">${p.title}</h2>
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
              : areas.map(
                  (a) => html`
                    <section class="psy-vault__area">
                      <h4>
                        ${t(`vault.material.${a.area}`)}
                        <span class="psy-vault__area-count">${a.total}</span>
                      </h4>
                      <ul class="psy-vault__entries">
                        ${a.entries.map((e) => this.renderEntry(e))}
                      </ul>
                      ${a.truncated
                        ? html`<p class="psy-vault__more">
                            ${t("vault.showingOf", {
                              listed: String(a.listed),
                              total: String(a.total),
                            })}
                          </p>`
                        : nothing}
                    </section>
                  `,
                )}

        <button
          type="button"
          class="psy-vault__ask"
          @click=${() =>
            handOffPrompt(t("vault.askCortexPrompt", { title: p.title, id: p.projectId }))}
        >
          ${t("vault.askCortex")}
        </button>
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
        ${this.matchedIds
          ? html`<p class="psy-vault__result-count">
              ${projects.length === 0
                ? t("vault.noResults", { query: this.searchedFor })
                : t("vault.resultCount", { count: String(projects.length) })}
            </p>`
          : nothing}

        <div class="psy-vault__body">
          <div class="psy-vault__grid">
            ${projects.length === 0 && !this.matchedIds
              ? html`<p class="psy-vault__empty-note">${t("vault.vaultEmpty")}</p>`
              : projects.map((p) => this.renderCard(p))}
          </div>
          ${this.selected ? this.renderDetail(this.selected) : nothing}
        </div>
      </div>
    `;
  }
}
