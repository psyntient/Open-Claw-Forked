// The Archive viewer: a way to see what is in the Noetic Archive without
// already knowing what to ask.
//
// WHY THIS EXISTS ALONGSIDE CORTEX
// Asking and browsing are different modes. You ask a question when you know
// what you are looking for; a researcher meeting the Archive for the first
// time has never seen the archetype vocabulary and so cannot form a good
// question yet. `confidence_tier` and `n_exemplars` are also comparative --
// "which of these are actually well-supported" is a scanning question that a
// laid-out field answers instantly and a chat reply answers badly.
//
// WHAT IT DRAWS, AND WHAT IT DOES NOT
// The grid encodes only what the data says: how established an archetype is
// (tier) and how much evidence stands behind it (exemplars).
//
// Archetype-to-archetype edges ARE real -- each record carries a `related` map
// of {id: why}, authored by the Architect. Those are shown as links in the
// detail panel. What is still missing is packet<->archetype `mappings` (0 in
// this Edition), which is what a similarity or clustering layout would need,
// so no such layout is drawn: it would be inventing structure.
//
// It is a reading surface. Questions hand off to Cortex rather than growing an
// analysis tool here.
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";
import { handOffPrompt } from "../../lib/psyntient-prompt-handoff.ts";

type Archetype = {
  id: string;
  slug: string;
  name: string;
  description: string;
  confidenceTier?: string;
  confidence_tier?: string;
  exemplars?: number;
  n_exemplars?: number;
};

type Edition = {
  editionId: string;
  archetypeCount: number;
  packetCount: number;
  mappingCount: number;
  gitRef: string | null;
};

/**
 * The tree around an archetype, opened via the Family Tree button. Always
 * has a hub to show: a genus (hubIsGenus true, row = its species) when one
 * exists, otherwise the archetype itself (row = what it `related` to).
 */
type FamilyTree = {
  of: string;
  hub: Record<string, unknown> | null;
  hubIsGenus: boolean;
  row: Record<string, unknown>[];
  relatedWhy?: Record<string, string>;
};

/** One row in an archetype's Evidence list. */
type PacketSummary = {
  id: string;
  subject_id?: string;
  timestamp?: string;
  duration_seconds?: number;
  simulated?: boolean;
  confidence?: number;
};

/** One recording, opened by clicking an Evidence row. Normalized once, on
 *  fetch, out of the raw packet_json shell -- see openPacket(). */
type PacketDetail = {
  id: string;
  simulated: boolean;
  subjectId: string | null;
  timestamp: string | null;
  durationSeconds: number | null;
  reportText: string;
  contextTags: string[];
  neuralData: Record<string, unknown>;
  exemplifies: { archetypeId: string; confidence: number }[];
};

type FigureRef = { name: string; caption: string; url: string; bytes: number };

/** This Edition's own account of itself, opened from the hero's "About this
 *  Edition" button. `manifest` is passed through verbatim -- it is
 *  Edition-authored content, not this client's shape to define. */
type EditionInfo = {
  editionId: string;
  manifest: Record<string, unknown> | null;
  figures: FigureRef[];
  notes: string | null;
};

const ROUTE = "/__openclaw__/psyntient/archive";

/** Tier drives the visual weight; unknown tiers fall back rather than vanish. */
const TIER_ORDER = ["established", "emerging", "tentative"];

function tierOf(a: Archetype): string {
  return (a.confidenceTier ?? a.confidence_tier ?? "tentative").toLowerCase();
}
function exemplarsOf(a: Archetype): number {
  return a.exemplars ?? a.n_exemplars ?? 0;
}
/** Builds a card-shaped Archetype from a raw Archive record, defensively --
 *  shared by openById and the family tree, which both jump to a record that
 *  may not be in the current grid. */
function archetypeFromRaw(record: Record<string, unknown>, fallbackId: string): Archetype {
  return {
    id: String(record.id ?? fallbackId),
    slug: String(record.slug ?? ""),
    name: String(record.name ?? fallbackId),
    description: String(record.description ?? ""),
    confidence_tier: record.confidence_tier as string | undefined,
    n_exemplars: record.n_exemplars as number | undefined,
  };
}
/** A record's taxonomy fields (taxonomic_rank, parent_archetype, members,
 *  related, SIMULATED_TEST_DATA, ...) live inside archetype_json, not at
 *  the top level -- the top level is the flat card-summary shape. Every
 *  place that reads taxonomy detail off a raw record unwraps through this. */
function taxonomyOf(record: Record<string, unknown>): Record<string, unknown> {
  const nested = record.archetype_json;
  return nested && typeof nested === "object" ? (nested as Record<string, unknown>) : record;
}
/** Prettifies an archetype id into display text, e.g. "numinous encounter". */
function prettifyId(id: string): string {
  return id.replace(/^NA-\d+-/, "").replace(/-/g, " ");
}

@customElement("psyntient-archive-page")
export class PsyntientArchivePage extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  /** Supplied by the route loader from the live gateway connection. */
  @property({ attribute: false }) authToken: string | null = null;

  @state() private edition: Edition | null = null;
  @state() private archetypes: Archetype[] = [];
  @state() private selected: Archetype | null = null;
  @state() private detail: Record<string, unknown> | null = null;
  @state() private query = "";
  /** True while the grid shows search results rather than the full index. */
  @state() private searching = false;
  @state() private loading = true;
  @state() private errorText: string | null = null;
  /** Live stage label while a semantic search runs. */
  @state() private searchStage: string | null = null;
  /** 0-1. Eased toward a ceiling during the long stage; only 1 when done. */
  @state() private searchProgress = 0;
  /** The family tree around an archetype, opened via the Family Tree button.
   *  Takes over the detail overlay when set -- open()/openById() always clear
   *  it, so the two views never end up stacked or stale. */
  @state() private family: FamilyTree | null = null;
  @state() private familyLoading = false;
  /** The exemplar packets behind the currently-open (non-genus) archetype.
   *  Loaded un-awaited after the detail panel itself resolves, so a slow or
   *  failed fetch never blocks or breaks the archetype page around it. */
  @state() private evidence: PacketSummary[] | null = null;
  @state() private evidenceLoading = false;
  @state() private evidenceError: string | null = null;
  /** One recording, opened from an Evidence row. Takes over the overlay the
   *  same way family does -- open()/openById()/openFamily() all clear it. */
  @state() private packet: PacketDetail | null = null;
  @state() private packetLoading = false;
  /** This Edition's manifest + figures, opened from the hero. Figure bytes
   *  are fetched as blobs (an <img src> can't carry the Authorization
   *  header the gateway route needs) and tracked here so their object URLs
   *  get revoked on close rather than leaking for the tab's lifetime. */
  @state() private editionInfo: EditionInfo | null = null;
  @state() private editionInfoLoading = false;
  @state() private figureUrls: Map<string, string> = new Map();

  private searchAbort: AbortController | null = null;
  private progressTimer: ReturnType<typeof setInterval> | null = null;

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.stopSearch();
    for (const url of this.figureUrls.values()) URL.revokeObjectURL(url);
  }

  private stopSearch() {
    this.searchAbort?.abort();
    this.searchAbort = null;
    if (this.progressTimer) clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  private async get(params = ""): Promise<Record<string, unknown> | null> {
    try {
      const res = await fetch(`${ROUTE}${params}`, {
        headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {},
      });
      if (!res.ok) {
        // Surfaced rather than swallowed: a 401 here used to fall through and
        // render an empty page with no explanation, which reads as "the
        // Archive is empty" instead of "this request was not authorised".
        this.errorText = t("archive.requestFailed", { status: String(res.status) });
        return null;
      }
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      this.errorText = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  override connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  override updated(changed: Map<string, unknown>) {
    // The loader resolves after first paint, so the token can arrive late.
    if (changed.has("authToken") && this.authToken && !this.edition) {
      void this.load();
    }
  }

  private async load() {
    this.loading = true;
    const body = await this.get();
    this.loading = false;
    if (!body) return;
    if (body.ok === false) {
      this.errorText = String(body.error ?? "");
      return;
    }
    this.errorText = null;
    this.edition = (body.edition as Edition) ?? null;
    this.archetypes = (body.archetypes as Archetype[]) ?? [];
  }

  /**
   * Semantic search: match a description against the archetype index, then
   * batch-fetch only the matches.
   *
   * Streamed over SSE because the match step is a real model call taking tens
   * of seconds. The stage labels are real; the motion between them is not
   * pretending to be fractional progress -- see the progress note below.
   */
  private runSearch() {
    const q = this.query.trim();
    if (!q) {
      void this.clearSearch();
      return;
    }
    this.stopSearch();
    this.loading = true;
    this.errorText = null;
    this.searchStage = t("archive.stageStarting");
    this.searchProgress = 0.02;

    // The long stage is one opaque model call that cannot report from inside
    // it, so the bar eases toward a ceiling on elapsed time and only ever
    // reaches 1 when the result actually lands. Motion means "working", not
    // "this fraction is done" -- and the bar animates continuously regardless,
    // so a slow stage never looks like a stall.
    const started = Date.now();
    this.progressTimer = setInterval(() => {
      const seconds = (Date.now() - started) / 1000;
      // Approaches ~0.92 asymptotically: fast at first, never claims to finish.
      this.searchProgress = Math.min(0.92, 1 - Math.exp(-seconds / 14));
    }, 120);

    // fetch + a stream reader rather than EventSource: EventSource cannot set
    // an Authorization header, and the alternative -- a token in the query
    // string -- puts a bearer credential into URLs, browser history and any
    // access log in the path. The SSE framing is simple enough to parse here.
    void this.streamSearch(q);
  }

  private async streamSearch(query: string) {
    const controller = new AbortController();
    this.searchAbort = controller;
    try {
      const res = await fetch(`${ROUTE}/search?query=${encodeURIComponent(query)}`, {
        headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {},
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(t("archive.requestFailed", { status: String(res.status) }));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE frames are separated by a blank line; keep any partial tail.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const eventLine = frame.split("\n").find((l) => l.startsWith("event:"));
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const name = eventLine.slice(6).trim();
          const payload = JSON.parse(dataLine.slice(5).trim());
          if (name === "stage") {
            this.searchStage = t(`archive.stage.${payload.stage}`, {
              detail: payload.detail ?? "",
            });
          } else if (name === "result") {
            this.applySearchResult(payload);
          }
        }
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      this.stopSearch();
      this.loading = false;
      this.searchStage = null;
      this.errorText = err instanceof Error ? err.message : t("archive.searchFailed");
    }
  }

  private applySearchResult(body: { ok?: boolean; error?: string; archetypes?: Archetype[] }) {
    this.stopSearch();
    this.searchProgress = 1;
    this.loading = false;
    this.searchStage = null;
    if (body.ok === false) {
      this.errorText = body.error ?? t("archive.searchFailed");
      return;
    }
    this.searching = true;
    this.archetypes = body.archetypes ?? [];
  }

  /**
   * Back to the full index.
   *
   * Needed because a search returning nothing was a dead end: the grid went
   * empty with no control to undo it, so the only way back to the archetypes
   * was to leave the viewer and come back.
   */
  private async clearSearch() {
    this.stopSearch();
    this.searchStage = null;
    this.searchProgress = 0;
    this.query = "";
    this.searching = false;
    await this.load();
  }

  private async open(a: Archetype) {
    this.family = null;
    this.packet = null;
    this.closeEditionInfo();
    this.selected = a;
    this.detail = null;
    this.evidence = null;
    this.evidenceError = null;
    const body = await this.get(`?id=${encodeURIComponent(a.id)}`);
    if (body?.ok !== false) {
      this.detail = (body?.record as Record<string, unknown>) ?? null;
      void this.loadEvidence(a.id);
    }
  }

  /**
   * The family tree, always requested by the CURRENTLY open archetype's own
   * id -- the daemon resolves upward on its own (parent_archetype, or the id
   * itself when it is already a genus) and falls back to the archetype
   * itself + what it relates to when there is no genus, so this always has
   * something to show and the caller never has to know which case it got.
   */
  private async openFamily(id: string) {
    this.family = null;
    this.packet = null;
    this.closeEditionInfo();
    this.familyLoading = true;
    const body = await this.get(`?family=${encodeURIComponent(id)}`);
    this.familyLoading = false;
    if (body?.ok === false) return;
    this.family = {
      of: String(body?.of ?? id),
      hub: (body?.hub as Record<string, unknown> | null) ?? null,
      hubIsGenus: body?.hubIsGenus === true,
      row: (body?.row as Record<string, unknown>[]) ?? [],
      relatedWhy: (body?.relatedWhy as Record<string, string> | undefined) ?? undefined,
    };
  }

  private closeFamily() {
    this.family = null;
  }

  private closeDetail() {
    this.selected = null;
    this.detail = null;
    this.evidence = null;
    this.evidenceError = null;
  }

  /**
   * The exemplar packets behind an archetype -- fired un-awaited right after
   * the detail panel resolves, so a slow evidence fetch never blocks the
   * page around it, and a failure replaces only this section's own
   * placeholder. Genus records have no exemplars of their own (the taxonomy
   * whitepaper's layer-3 concept lives on species), so this reads the
   * already-set this.detail rather than re-deriving isGenus from the
   * caller, which would need to know that rule too.
   */
  private async loadEvidence(id: string) {
    const meta = taxonomyOf(this.detail ?? {});
    if (meta.taxonomic_rank === "genus") return;
    this.evidenceLoading = true;
    const body = await this.get(`?evidence=${encodeURIComponent(id)}`);
    this.evidenceLoading = false;
    if (body?.ok === false) {
      this.evidenceError = t("archive.evidenceFailed");
      return;
    }
    const items = ((body?.items as PacketSummary[] | undefined) ?? []).slice();
    items.sort((x, y) => (y.confidence ?? 0) - (x.confidence ?? 0));
    this.evidence = items;
  }

  /** One recording, opened from an Evidence row. Normalizes the raw
   *  packet_json shell into a flat PacketDetail once, here, so the render
   *  methods never have to re-unwrap it. */
  private async openPacket(id: string) {
    this.family = null;
    this.selected = null;
    this.detail = null;
    this.packet = null;
    this.closeEditionInfo();
    this.packetLoading = true;
    const body = await this.get(`?packet=${encodeURIComponent(id)}`);
    this.packetLoading = false;
    if (body?.ok === false) return;
    const record = (body?.record as Record<string, unknown>) ?? {};
    const nested = record.packet_json;
    const pj = (nested && typeof nested === "object" ? nested : record) as Record<string, unknown>;
    const exemplifiesRaw = (body?.exemplifies as Array<Record<string, unknown>>) ?? [];
    const exemplifies = exemplifiesRaw
      .map((e) => ({
        archetypeId: String(e.archetype_id ?? ""),
        confidence: Number(e.confidence ?? 0),
      }))
      .filter((e) => e.archetypeId)
      .sort((x, y) => y.confidence - x.confidence);
    this.packet = {
      id: String(record.id ?? id),
      simulated: record.simulated === true,
      subjectId: typeof record.subject_id === "string" ? record.subject_id : null,
      timestamp: typeof record.timestamp === "string" ? record.timestamp : null,
      durationSeconds: typeof record.duration_seconds === "number" ? record.duration_seconds : null,
      reportText: typeof pj.report_text === "string" ? pj.report_text : "",
      contextTags: Array.isArray(pj.context_tags)
        ? pj.context_tags.filter((v): v is string => typeof v === "string")
        : [],
      neuralData:
        pj.neural_data && typeof pj.neural_data === "object"
          ? (pj.neural_data as Record<string, unknown>)
          : {},
      exemplifies,
    };
  }

  private closePacket() {
    this.packet = null;
  }

  /** This Edition's manifest + figures. Figure bytes load un-awaited, one
   *  fetch each, after the manifest itself resolves -- the manifest alone
   *  is enough to render the overlay, and a slow or failed figure fetch
   *  should not hold up the ones that succeeded. */
  private async openEditionInfo() {
    this.family = null;
    this.packet = null;
    this.selected = null;
    this.editionInfo = null;
    this.editionInfoLoading = true;
    const body = await this.get("?manifest=1");
    this.editionInfoLoading = false;
    if (body?.ok === false) return;
    const figures = (body?.figures as FigureRef[] | undefined) ?? [];
    this.editionInfo = {
      editionId: String(body?.edition_id ?? ""),
      manifest: (body?.manifest as Record<string, unknown> | null) ?? null,
      figures,
      notes: typeof body?.notes === "string" ? body.notes : null,
    };
    for (const fig of figures) void this.loadFigure(fig.name);
  }

  private closeEditionInfo() {
    this.editionInfo = null;
    for (const url of this.figureUrls.values()) URL.revokeObjectURL(url);
    this.figureUrls = new Map();
  }

  /** Fetches one figure's bytes as a blob and stores an object URL for it --
   *  an <img src> request carries no Authorization header, so the gateway's
   *  figure route (like every other archive route) can't be pointed at
   *  directly from markup. */
  private async loadFigure(name: string) {
    try {
      const res = await fetch(`${ROUTE}/figure?name=${encodeURIComponent(name)}`, {
        headers: this.authToken ? { Authorization: `Bearer ${this.authToken}` } : {},
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const next = new Map(this.figureUrls);
      next.set(name, URL.createObjectURL(blob));
      this.figureUrls = next;
    } catch {
      // A figure that fails to load just doesn't appear -- the manifest's
      // own figure list already told the reader which ones exist.
    }
  }

  /** Closes an overlay when its backdrop itself is clicked, not a bubbled
   *  click from the panel or anything inside it. */
  private static onBackdropClick(e: Event, close: () => void) {
    if (e.target === e.currentTarget) close();
  }

  /**
   * Hand the question to Cortex rather than answering it here.
   *
   * The prompt names the genus explicitly when the archetype has one, and
   * otherwise asks Cortex to offer the family as a follow-up. Either way the
   * conversation can go up a taxonomic level, which is the move a researcher
   * wants next and which a single archetype page cannot answer.
   */
  private askCortex(a: Archetype) {
    const raw = (this.detail?.archetype_json ?? {}) as Record<string, unknown>;
    const genus = typeof raw.parent_archetype === "string" ? raw.parent_archetype : null;
    const prompt = genus
      ? `Tell me about the "${a.name}" archetype in the Noetic Archive and the evidence behind it. It belongs to the genus ${genus} — afterwards, ask me whether I want to hear about that whole family and how its species relate.`
      : `Tell me about the "${a.name}" archetype in the Noetic Archive and the evidence behind it. Afterwards, ask me whether I want to explore the archetype family it would sit in — and say plainly if this Edition has not grouped it into a genus yet.`;
    handOffPrompt(prompt);
    location.href = "/new";
  }

  private renderStat(label: string, value: string | number) {
    return html`
      <div class="psy-arch__stat">
        <span class="psy-arch__stat-value">${value}</span>
        <span class="psy-arch__stat-label">${label}</span>
      </div>
    `;
  }

  private renderCard(a: Archetype) {
    const n = exemplarsOf(a);
    const tier = tierOf(a);
    // Weight is relative to the best-supported archetype in view, so the field
    // stays readable whether the Archive holds 25 exemplars or 25,000.
    const max = Math.max(1, ...this.archetypes.map(exemplarsOf));
    const weight = Math.min(1, n / max);
    return html`
      <button
        type="button"
        class="psy-arch__card psy-arch__card--${tier}"
        style=${`--psy-arch-weight:${weight.toFixed(3)}`}
        @click=${() => this.open(a)}
      >
        <span class="psy-arch__card-bar" aria-hidden="true"></span>
        <span class="psy-arch__card-name">${a.name}</span>
        <span class="psy-arch__card-desc">${a.description}</span>
        <span class="psy-arch__card-meta">
          <span class="psy-arch__tier psy-arch__tier--${tier}">${tier}</span>
          <span
            >${n === 1
              ? t("archive.exemplarOne")
              : t("archive.exemplarMany", { count: String(n) })}</span
          >
        </span>
      </button>
    `;
  }

  /**
   * The order the grid renders, shared with the detail panel's prev/next so
   * stepping through matches the sequence on screen rather than array order.
   */
  private displayOrder(): Archetype[] {
    return [...this.archetypes].sort((a, b) => {
      const ta = TIER_ORDER.indexOf(tierOf(a));
      const tb = TIER_ORDER.indexOf(tierOf(b));
      // Best-established first, then best-supported: the reader's first
      // question is "what does this Archive actually know", not "what is
      // alphabetically first".
      return (ta === -1 ? 99 : ta) - (tb === -1 ? 99 : tb) || exemplarsOf(b) - exemplarsOf(a);
    });
  }

  /**
   * Move to the adjacent archetype without closing the panel.
   *
   * Wraps at both ends: a reader flipping through a small result set should
   * not hit a dead stop and have to close, scroll and re-open. Genus records
   * reached via a family link are not in the list, so stepping from one
   * re-enters the list at the start rather than doing nothing.
   */
  private step(delta: number) {
    const list = this.displayOrder();
    if (list.length === 0) return;
    const current = list.findIndex((x) => x.id === this.selected?.id);
    const next = current === -1 ? 0 : (current + delta + list.length) % list.length;
    const target = list[next];
    if (target) void this.open(target);
  }

  override render() {
    const sorted = this.displayOrder();

    return html`
      <div class="psy-arch">
        <header class="psy-arch__hero">
          <h1 class="psy-arch__title">${t("archive.title")}</h1>
          <p class="psy-arch__sub">${t("archive.subtitle")}</p>
          ${this.edition
            ? html`
                <div class="psy-arch__stats">
                  ${this.renderStat(t("archive.archetypes"), this.edition.archetypeCount)}
                  ${this.renderStat(t("archive.packets"), this.edition.packetCount)}
                  ${this.renderStat(t("archive.mappings"), this.edition.mappingCount)}
                </div>
                <p class="psy-arch__edition">
                  ${t("archive.edition", { id: this.edition.editionId })}
                  <button
                    type="button"
                    class="psy-arch__edition-link"
                    @click=${() => this.openEditionInfo()}
                  >
                    ${t("archive.aboutEdition")}
                  </button>
                </p>
                <!-- Stated plainly rather than hidden. An Archive of
                     archetypes with no packets behind them is the real current
                     state, and a viewer that implied otherwise would be the
                     most misleading thing in the product. -->
                ${this.edition.packetCount === 0
                  ? html`<p class="psy-arch__notice">${t("archive.noPackets")}</p>`
                  : nothing}
              `
            : nothing}
        </header>

        ${this.errorText
          ? html`<p class="psy-arch__error" role="alert">${this.errorText}</p>`
          : nothing}

        <div class="psy-arch__search">
          <input
            type="search"
            placeholder=${t("archive.searchPlaceholder")}
            .value=${this.query}
            @input=${(e: Event) => (this.query = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") this.runSearch();
            }}
          />
          <button type="button" @click=${() => this.runSearch()}>${t("archive.search")}</button>
        </div>

        ${this.loading
          ? this.searchStage
            ? html`
                <div class="psy-arch__progress" role="status" aria-live="polite">
                  <div class="psy-arch__progress-track">
                    <div
                      class="psy-arch__progress-fill"
                      style=${`width:${(this.searchProgress * 100).toFixed(1)}%`}
                    ></div>
                  </div>
                  <p class="psy-arch__progress-label">${this.searchStage}</p>
                </div>
              `
            : html`<p class="psy-arch__loading">${t("archive.loading")}</p>`
          : sorted.length === 0
            ? html`
                <div class="psy-arch__empty">
                  <p>${t("archive.noResults", { query: this.query })}</p>
                  <button type="button" class="psy-arch__ask" @click=${() => this.clearSearch()}>
                    ${t("archive.showAll")}
                  </button>
                </div>
              `
            : html`
                ${this.searching
                  ? html`<div class="psy-arch__result-bar">
                      <span>${t("archive.resultCount", { count: String(sorted.length) })}</span>
                      <button
                        type="button"
                        class="psy-arch__clear"
                        @click=${() => this.clearSearch()}
                      >
                        ${t("archive.showAll")}
                      </button>
                    </div>`
                  : nothing}
                <div class="psy-arch__grid">${sorted.map((a) => this.renderCard(a))}</div>
              `}
        ${this.packetLoading || this.packet
          ? this.renderPacketDetail()
          : this.editionInfoLoading || this.editionInfo
            ? this.renderEditionInfo()
            : this.familyLoading || this.family
              ? this.renderFamilyTree()
              : this.selected
                ? this.renderDetail(this.selected)
                : nothing}
      </div>
    `;
  }

  /** A titled block, rendered only when the Archive actually has that field. */
  private renderSection(title: string, body: unknown) {
    if (body === null || body === undefined) return nothing;
    if (Array.isArray(body) && body.length === 0) return nothing;
    return html`
      <section class="psy-arch__section">
        <h3 class="psy-arch__section-title">${title}</h3>
        ${body}
      </section>
    `;
  }

  private renderList(items: unknown): unknown {
    const list = Array.isArray(items) ? items.filter((v) => typeof v === "string") : [];
    if (list.length === 0) return null;
    return html`<ul class="psy-arch__list">
      ${list.map((v) => html`<li>${v}</li>`)}
    </ul>`;
  }

  private renderDetail(a: Archetype) {
    const raw = (this.detail?.archetype_json ?? {}) as Record<string, unknown>;
    const phenom = (raw.phenomenological_signature ?? {}) as Record<string, unknown>;
    const neural = (raw.neural_signature ?? {}) as Record<string, unknown>;
    const bounds = (raw.boundary_conditions ?? {}) as Record<string, unknown>;
    const related = (raw.related ?? {}) as Record<string, string>;
    const modality = (raw.modality_coverage ?? {}) as Record<string, number>;
    const relatedIds = Object.keys(related);
    const modalityKeys = Object.keys(modality);
    const isGenus = raw.taxonomic_rank === "genus";
    const genusKind = typeof raw.genus_kind_label === "string" ? raw.genus_kind_label : null;
    const members = Array.isArray(raw.members)
      ? raw.members.filter((m): m is string => typeof m === "string")
      : [];
    const list = this.displayOrder();
    const position = list.findIndex((x) => x.id === a.id);
    const inList = position !== -1 && list.length > 1;
    const listLength = list.length;

    return html`
      <div
        class="psy-arch__detail"
        role="dialog"
        aria-modal="true"
        @click=${(e: Event) => PsyntientArchivePage.onBackdropClick(e, () => this.closeDetail())}
      >
        <div class="psy-arch__detail-panel">
          <div class="psy-arch__detail-nav">
            <!-- Flip through without leaving the panel. Hidden for a record
                 that is not in the current list (a genus opened from a family
                 link), where "next" has no meaningful referent. -->
            ${inList
              ? html`
                  <button
                    type="button"
                    class="psy-arch__step"
                    aria-label=${t("archive.previous")}
                    @click=${() => this.step(-1)}
                  >
                    ‹
                  </button>
                  <span class="psy-arch__step-count"
                    >${t("archive.position", {
                      index: String(position + 1),
                      total: String(listLength),
                    })}</span
                  >
                  <button
                    type="button"
                    class="psy-arch__step"
                    aria-label=${t("archive.next")}
                    @click=${() => this.step(1)}
                  >
                    ›
                  </button>
                `
              : nothing}
            <button
              type="button"
              class="psy-arch__close"
              aria-label=${t("archive.close")}
              @click=${() => this.closeDetail()}
            >
              ×
            </button>
          </div>
          <span class="psy-arch__tier psy-arch__tier--${tierOf(a)}">${tierOf(a)}</span>
          <h2 class="psy-arch__detail-name">${a.name}</h2>
          <p class="psy-arch__detail-desc">${a.description}</p>

          <div class="psy-arch__facts">
            ${isGenus
              ? html`<span class="psy-arch__chip"
                  >${t("archive.genusRank")}${genusKind ? ` · ${genusKind}` : ""}</span
                >`
              : html`<span>${t("archive.exemplarMany", { count: String(exemplarsOf(a)) })}</span>`}
            ${isGenus
              ? html`<span>${t("archive.speciesCount", { count: String(members.length) })}</span>`
              : nothing}
            ${modalityKeys.map(
              (m) => html`<span class="psy-arch__chip">${m} · ${modality[m]}</span>`,
            )}
          </div>

          <!-- Layer 3 of the taxonomy (whitepaper 2.3): species archetypes may
               belong to a genus, itself an archetype record, via
               parent_archetype. Rendered as a real link when present and stated
               plainly when not -- Edition 002 ships zero genera (its only one
               was a smoke test the Architect deliberately dissolved), so a
               silent button here would do nothing for every archetype in the
               Archive. -->
          ${this.detail && !isGenus
            ? typeof raw.parent_archetype === "string" && raw.parent_archetype
              ? html`<p class="psy-arch__genus">
                  <span class="psy-arch__genus-label">${t("archive.family")}</span>
                  <button
                    type="button"
                    class="psy-arch__related-link"
                    @click=${() => this.openById(String(raw.parent_archetype))}
                  >
                    ${prettifyId(String(raw.parent_archetype))}
                  </button>
                </p>`
              : html`<p class="psy-arch__genus psy-arch__genus--none">${t("archive.noFamily")}</p>`
            : nothing}
          <!-- The evidence list: what used to be a bare "N exemplars" count
               with nothing behind it. Genus records have no exemplars of
               their own (see loadEvidence()), so this is species-only.
               Loads after the panel itself, un-awaited -- see open()/
               openById() -- and a failure replaces only this section's own
               placeholder rather than the whole page. -->
          ${!isGenus ? this.renderSection(t("archive.evidence"), this.renderEvidence()) : nothing}
          ${this.detail
            ? html`
                <!-- The species in this family, first: "which archetypes are
                     in here" is the question that made someone click through,
                     and it is the one thing a genus record has that a species
                     record does not. -->
                ${this.renderSection(
                  t("archive.members", { count: String(members.length) }),
                  members.length
                    ? html`<ul class="psy-arch__related">
                        ${members.map(
                          (id) => html`
                            <li>
                              <button
                                type="button"
                                class="psy-arch__related-link"
                                @click=${() => this.openById(id)}
                              >
                                ${prettifyId(id)}
                              </button>
                            </li>
                          `,
                        )}
                      </ul>`
                    : null,
                )}
                ${this.renderSection(t("archive.invariants"), this.renderList(phenom.invariants))}
                ${this.renderSection(
                  t("archive.variants"),
                  this.renderList(phenom.common_variants),
                )}
                ${this.renderSection(
                  t("archive.neural"),
                  typeof neural.hypothesized === "string"
                    ? html`<p class="psy-arch__prose">${neural.hypothesized}</p>`
                    : null,
                )}
                <!-- "What this is not" is as useful as what it is: these
                     archetypes are deliberately close to one another, and
                     boundary_conditions is how the Architect keeps them
                     distinguishable. -->
                ${this.renderSection(t("archive.notThis"), this.renderList(bounds.not))}
                ${this.renderSection(
                  t("archive.nearNeighbours"),
                  this.renderList(bounds.near_neighbors),
                )}
                ${this.renderSection(
                  t("archive.related"),
                  relatedIds.length
                    ? html`<ul class="psy-arch__related">
                        ${relatedIds.map(
                          (id) => html`
                            <li>
                              <button
                                type="button"
                                class="psy-arch__related-link"
                                @click=${() => this.openById(id)}
                              >
                                ${prettifyId(id)}
                              </button>
                              <span class="psy-arch__related-why">${related[id]}</span>
                            </li>
                          `,
                        )}
                      </ul>`
                    : null,
                )}
                ${this.renderSection(
                  t("archive.openQuestions"),
                  this.renderList(raw.open_questions),
                )}
              `
            : html`<p class="psy-arch__loading">${t("archive.loading")}</p>`}

          <div class="psy-arch__detail-actions">
            <button class="psy-arch__ask" type="button" @click=${() => this.askCortex(a)}>
              ${t("archive.askCortex")}
            </button>
            <!-- Always available: the daemon falls back to the archetype
                 itself + what it relates to when there is no genus, so
                 there is always a tree to show. The Family/Genus text above
                 stays a separate, direct jump to one specific record -- this
                 button is the whole pyramid. -->
            <button class="psy-arch__ask" type="button" @click=${() => this.openFamily(a.id)}>
              ${t("archive.familyTree")}
            </button>
            <code class="psy-arch__detail-id">${a.id}</code>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Three tiers: the genus, its species on one rank beneath it, and under
   * each species the archetypes it relates to. Grounded entirely in real
   * parent_archetype/members edges the Architect authored -- never in
   * packet<->archetype mappings, which are 0 in this Edition and would mean
   * inventing structure the Archive does not assert (see the file header).
   */
  private renderFamilyTree() {
    const closeButton = html`
      <button
        type="button"
        class="psy-arch__close"
        aria-label=${t("archive.close")}
        @click=${() => this.closeFamily()}
      >
        ×
      </button>
    `;

    if (this.familyLoading || !this.family) {
      return html`
        <div
          class="psy-arch__detail"
          role="dialog"
          aria-modal="true"
          @click=${(e: Event) => PsyntientArchivePage.onBackdropClick(e, () => this.closeFamily())}
        >
          <div class="psy-arch__tree-panel">
            ${closeButton}
            <p class="psy-arch__loading">${t("archive.loading")}</p>
          </div>
        </div>
      `;
    }

    const { hub, hubIsGenus, row, relatedWhy } = this.family;
    if (!hub) {
      // Only reachable if the id resolved to a packet, not an archetype --
      // genuinely nothing taxonomic to say about it.
      return html`
        <div
          class="psy-arch__detail"
          role="dialog"
          aria-modal="true"
          @click=${(e: Event) => PsyntientArchivePage.onBackdropClick(e, () => this.closeFamily())}
        >
          <div class="psy-arch__tree-panel">
            ${closeButton}
            <p class="psy-arch__genus--none">${t("archive.notAnArchetype")}</p>
          </div>
        </div>
      `;
    }

    // Every genus in this Edition is seeded test data as of this writing (see
    // ARCHIVE_VIEWER.md) -- a surface built for citation that displayed a
    // dissolved smoke test as real taxonomy would be worse than no taxonomy
    // view at all. Read off the record, not hardcoded: a real genus the
    // Architect derives later carries no flag and this banner simply will
    // not appear for it.
    const hubMeta = taxonomyOf(hub);
    const simulated = hubMeta.SIMULATED_TEST_DATA === true;
    const hubNote = typeof hubMeta.note === "string" ? hubMeta.note : null;
    const genusKind =
      typeof hubMeta.genus_kind_label === "string" ? hubMeta.genus_kind_label : null;
    const hubId = String(hub.id ?? "");
    const hubArchetype = archetypeFromRaw(hub, hubId);

    return html`
      <div
        class="psy-arch__detail"
        role="dialog"
        aria-modal="true"
        @click=${(e: Event) => PsyntientArchivePage.onBackdropClick(e, () => this.closeFamily())}
      >
        <div class="psy-arch__tree-panel">
          ${closeButton}
          ${simulated
            ? html`<div class="psy-arch__tree-simulated-banner">
                <strong
                  >${t("archive.treeSimulatedTitle", { name: String(hub.name ?? "") })}</strong
                >
                <p>${hubNote ?? t("archive.treeSimulatedFallback")}</p>
                <p>${t("archive.treeSimulatedWarning")}</p>
              </div>`
            : nothing}

          <button
            type="button"
            class="psy-arch__tree-node psy-arch__tree-node--hub ${this.family.of === hubId
              ? "psy-arch__tree-node--you"
              : ""}"
            @click=${() => this.openById(hubId)}
          >
            ${simulated
              ? html`<span class="psy-arch__tree-badge">${t("archive.testData")}</span>`
              : nothing}
            <span class="psy-arch__tree-node-name">${String(hub.name ?? hubId)}</span>
            <span class="psy-arch__tree-node-desc">${String(hub.description ?? "")}</span>
            <span class="psy-arch__tree-node-meta">
              ${hubIsGenus
                ? html`<span class="psy-arch__chip"
                      >${t("archive.genusRank")}${genusKind ? ` · ${genusKind}` : ""}</span
                    >
                    <span>${t("archive.speciesCount", { count: String(row.length) })}</span>`
                : html`<span class="psy-arch__tier psy-arch__tier--${tierOf(hubArchetype)}"
                      >${tierOf(hubArchetype)}</span
                    >
                    ${row.length
                      ? html`<span
                          >${t("archive.relatedCount", { count: String(row.length) })}</span
                        >`
                      : nothing}`}
            </span>
          </button>

          ${row.length
            ? html`
                <div class="psy-arch__tree-stem" aria-hidden="true"></div>
                <div class="psy-arch__tree-bar" style=${`--n:${row.length}`}></div>
                <div class="psy-arch__tree-row" style=${`--n:${row.length}`}>
                  ${row.map((s) => this.renderTreeRowItem(s, hubIsGenus, relatedWhy))}
                </div>
              `
            : hubIsGenus
              ? nothing
              : html`<p class="psy-arch__genus--none">${t("archive.noRelated")}</p>`}
        </div>
      </div>
    `;
  }

  /**
   * One card in the row beneath the hub. When the hub is a genus, this is a
   * sibling species and gets its OWN related archetypes as a third tier of
   * chips beneath it. When the hub is not a genus, this IS one of the hub's
   * `related` edges -- shown with its authored reason instead, and no
   * further tier: related-of-related is a different, deeper question this
   * view does not try to answer.
   */
  private renderTreeRowItem(
    s: Record<string, unknown>,
    hubIsGenus: boolean,
    relatedWhy?: Record<string, string>,
  ) {
    const id = String(s.id ?? "");
    const a = archetypeFromRaw(s, id);
    const card = html`
      <button
        type="button"
        class="psy-arch__tree-node ${this.family?.of === id ? "psy-arch__tree-node--you" : ""}"
        @click=${() => this.openById(id)}
      >
        <span class="psy-arch__tree-node-name">${a.name}</span>
        <span class="psy-arch__tree-node-desc">${a.description}</span>
        <span class="psy-arch__tree-node-meta">
          <span class="psy-arch__tier psy-arch__tier--${tierOf(a)}">${tierOf(a)}</span>
        </span>
      </button>
    `;

    if (!hubIsGenus) {
      const why = relatedWhy?.[id];
      return html`
        <div class="psy-arch__tree-col">
          <div class="psy-arch__tree-col-stem" aria-hidden="true"></div>
          ${card} ${why ? html`<p class="psy-arch__related-why">${why}</p>` : nothing}
        </div>
      `;
    }

    const related = (taxonomyOf(s).related ?? {}) as Record<string, string>;
    const relatedIds = Object.keys(related);
    return html`
      <div class="psy-arch__tree-col">
        <div class="psy-arch__tree-col-stem" aria-hidden="true"></div>
        ${card}
        ${relatedIds.length
          ? html`<div class="psy-arch__tree-related">
              ${relatedIds.map((rid) => {
                // A cross-reference can outlive its target; render those as
                // plain text instead of a dead link rather than fetching to
                // find out (the index this checks against is already loaded).
                const inEdition = this.archetypes.some((x) => x.id === rid);
                return inEdition
                  ? html`<button
                      type="button"
                      class="psy-arch__tree-related-chip psy-arch__tree-related-chip--link"
                      title=${related[rid]}
                      @click=${() => this.openById(rid)}
                    >
                      ${prettifyId(rid)}
                    </button>`
                  : html`<span class="psy-arch__tree-related-chip" title=${related[rid]}
                      >${prettifyId(rid)}</span
                    >`;
              })}
            </div>`
          : nothing}
      </div>
    `;
  }

  /**
   * The evidence list body: strongest exemplar first, real/simulated split
   * stated in words above the list rather than as per-row badges -- the
   * single most important fact about an archetype's evidence belongs where
   * a reader sees it before reading a single packet id, not buried in it.
   */
  private renderEvidence() {
    if (this.evidenceError) {
      return html`<p class="psy-arch__evidence-error">${this.evidenceError}</p>`;
    }
    if (this.evidenceLoading || this.evidence === null) {
      return html`<p class="psy-arch__loading">${t("archive.loading")}</p>`;
    }
    if (this.evidence.length === 0) {
      return html`<p class="psy-arch__genus--none">${t("archive.evidenceNone")}</p>`;
    }
    const count = this.evidence.length;
    const simulated = this.evidence.filter((p) => p.simulated === true).length;
    const provenance =
      simulated === count
        ? t("archive.evidenceAllSimulated", { count: String(count) })
        : simulated === 0
          ? t("archive.evidenceAllReal", { count: String(count) })
          : t("archive.evidenceMixed", { simulated: String(simulated), count: String(count) });
    return html`
      <p class="psy-arch__evidence-provenance">${provenance}</p>
      <ul class="psy-arch__evidence-list">
        ${this.evidence.map((p) => this.renderEvidenceRow(p))}
      </ul>
    `;
  }

  private renderEvidenceRow(p: PacketSummary) {
    const pct = Math.round(Math.max(0, Math.min(1, p.confidence ?? 0)) * 100);
    return html`
      <li>
        <button type="button" class="psy-arch__evidence-row" @click=${() => this.openPacket(p.id)}>
          <span class="psy-arch__evidence-bar-track">
            <span class="psy-arch__evidence-bar-fill" style=${`width:${pct}%`}></span>
          </span>
          <span class="psy-arch__evidence-meta">
            <code class="psy-arch__evidence-id">${p.id}</code>
            ${p.subject_id ? html`<span>${p.subject_id}</span>` : nothing}
            <span class="psy-arch__evidence-confidence">${pct}%</span>
            ${p.simulated
              ? html`<span class="psy-arch__tree-badge">${t("archive.testData")}</span>`
              : nothing}
          </span>
        </button>
      </li>
    `;
  }

  /**
   * This Edition's own account of itself: the manifest's source/source_notes
   * (stated plainly, same posture as the packetCount===0 notice above --
   * "simulated, not clinical evidence" belongs on the page, not buried),
   * inclusion/promotion rules, the generated figures, and the figure
   * generator's own interpretation notes.
   */
  private renderEditionInfo() {
    const closeButton = html`
      <button
        type="button"
        class="psy-arch__close"
        aria-label=${t("archive.close")}
        @click=${() => this.closeEditionInfo()}
      >
        ×
      </button>
    `;

    if (this.editionInfoLoading || !this.editionInfo) {
      return html`
        <div
          class="psy-arch__detail"
          role="dialog"
          aria-modal="true"
          @click=${(e: Event) =>
            PsyntientArchivePage.onBackdropClick(e, () => this.closeEditionInfo())}
        >
          <div class="psy-arch__tree-panel">
            ${closeButton}
            <p class="psy-arch__loading">${t("archive.loading")}</p>
          </div>
        </div>
      `;
    }

    const { editionId, manifest, figures, notes } = this.editionInfo;
    const source = typeof manifest?.source === "string" ? manifest.source : null;
    const sourceNotes = typeof manifest?.source_notes === "string" ? manifest.source_notes : null;
    const inclusionRules =
      manifest?.inclusion_rules && typeof manifest.inclusion_rules === "object"
        ? (manifest.inclusion_rules as Record<string, unknown>)
        : null;
    const promotionCriteria =
      manifest?.promotion_criteria && typeof manifest.promotion_criteria === "object"
        ? (manifest.promotion_criteria as Record<string, unknown>)
        : null;

    return html`
      <div
        class="psy-arch__detail"
        role="dialog"
        aria-modal="true"
        @click=${(e: Event) =>
          PsyntientArchivePage.onBackdropClick(e, () => this.closeEditionInfo())}
      >
        <div class="psy-arch__tree-panel">
          ${closeButton}
          <h2 class="psy-arch__detail-name">${t("archive.edition", { id: editionId })}</h2>
          ${source
            ? html`<p class="psy-arch__evidence-provenance">
                ${t("archive.editionSource", { source })}
              </p>`
            : nothing}
          ${sourceNotes ? html`<p class="psy-arch__prose">${sourceNotes}</p>` : nothing}
          ${this.renderSection(
            t("archive.inclusionRules"),
            inclusionRules ? this.renderKeyValueList(inclusionRules) : null,
          )}
          ${this.renderSection(
            t("archive.promotionCriteria"),
            promotionCriteria ? this.renderKeyValueList(promotionCriteria) : null,
          )}
          ${this.renderSection(
            t("archive.figures"),
            figures.length
              ? html`<div class="psy-arch__figure-grid">
                  ${figures.map((fig) => {
                    const url = this.figureUrls.get(fig.name);
                    return html`<figure class="psy-arch__figure">
                      ${url
                        ? html`<img class="psy-arch__figure-img" src=${url} alt=${fig.caption} />`
                        : html`<div class="psy-arch__figure-loading">${t("archive.loading")}</div>`}
                      <figcaption>${fig.caption}</figcaption>
                    </figure>`;
                  })}
                </div>`
              : null,
          )}
          ${this.renderSection(
            t("archive.figureNotes"),
            notes ? html`<p class="psy-arch__prose psy-arch__figure-notes">${notes}</p>` : null,
          )}
        </div>
      </div>
    `;
  }

  private renderKeyValueList(obj: Record<string, unknown>) {
    const entries = Object.entries(obj);
    if (entries.length === 0) return null;
    return html`<ul class="psy-arch__list">
      ${entries.map(([k, v]) => html`<li>${k.replace(/_/g, " ")}: ${String(v)}</li>`)}
    </ul>`;
  }

  private renderPacketDetail() {
    const closeButton = html`
      <button
        type="button"
        class="psy-arch__close"
        aria-label=${t("archive.close")}
        @click=${() => this.closePacket()}
      >
        ×
      </button>
    `;

    if (this.packetLoading || !this.packet) {
      return html`
        <div
          class="psy-arch__detail"
          role="dialog"
          aria-modal="true"
          @click=${(e: Event) => PsyntientArchivePage.onBackdropClick(e, () => this.closePacket())}
        >
          <div class="psy-arch__tree-panel">
            ${closeButton}
            <p class="psy-arch__loading">${t("archive.loading")}</p>
          </div>
        </div>
      `;
    }

    const p = this.packet;
    const modalities = Object.keys(p.neuralData);

    return html`
      <div
        class="psy-arch__detail"
        role="dialog"
        aria-modal="true"
        @click=${(e: Event) => PsyntientArchivePage.onBackdropClick(e, () => this.closePacket())}
      >
        <div class="psy-arch__tree-panel">
          ${closeButton}
          <p class="psy-arch__packet-eyebrow">
            <code class="psy-arch__evidence-id">${p.id}</code>
            ${p.simulated
              ? html`<span class="psy-arch__tree-badge">${t("archive.testData")}</span>`
              : nothing}
          </p>
          ${p.reportText
            ? html`<p class="psy-arch__prose psy-arch__packet-report">${p.reportText}</p>`
            : nothing}
          ${p.contextTags.length
            ? html`<div class="psy-arch__tree-related">
                ${p.contextTags.map(
                  (tag) => html`<span class="psy-arch__tree-related-chip">${tag}</span>`,
                )}
              </div>`
            : nothing}
          ${modalities.map((m) =>
            this.renderSection(
              m,
              this.renderModalityChart(p.neuralData[m] as Record<string, unknown>),
            ),
          )}
          ${this.renderSection(
            t("archive.exemplifies"),
            p.exemplifies.length
              ? html`<ul class="psy-arch__related">
                  ${p.exemplifies.map(
                    (e) => html`
                      <li>
                        <button
                          type="button"
                          class="psy-arch__related-link"
                          @click=${() => this.openById(e.archetypeId)}
                        >
                          ${prettifyId(e.archetypeId)}
                        </button>
                        <span class="psy-arch__related-why"
                          >${Math.round(e.confidence * 100)}%</span
                        >
                      </li>
                    `,
                  )}
                </ul>`
              : null,
          )}
        </div>
      </div>
    `;
  }

  /**
   * One modality's chart. Dispatches on the shape of its timeline rather
   * than the modality's name: the first version read EEG's nested
   * band_powers shape directly, so any other modality drew nothing -- and
   * because a titled section renders nothing for an empty body, it drew
   * nothing SILENTLY. Archetypes are derived from several modalities at
   * once, so a renderer that only understands one of them fails quietly on
   * exactly the packets that matter most.
   */
  private renderModalityChart(data: Record<string, unknown>) {
    const timeline = Array.isArray(data.timeline) ? data.timeline : [];
    const points = timeline.filter(
      (pt): pt is Record<string, unknown> => !!pt && typeof pt === "object",
    );
    const nested =
      points.length > 0 &&
      points.every((pt) => pt.band_powers && typeof pt.band_powers === "object");
    const rows: Array<Record<string, number>> = nested
      ? (points.map((pt) => pt.band_powers) as Array<Record<string, number>>)
      : points
          .map((pt) => {
            const row: Record<string, number> = {};
            for (const [k, v] of Object.entries(pt)) {
              if (k !== "timestamp" && typeof v === "number") row[k] = v;
            }
            return row;
          })
          .filter((row) => Object.keys(row).length > 0);

    if (rows.length > 0) return this.renderSparkline(rows, nested);

    const summary =
      data.summary_features && typeof data.summary_features === "object"
        ? (data.summary_features as Record<string, unknown>)
        : null;
    const table = summary ? this.renderFeatureTable(summary) : null;
    if (table) return table;

    // Rendering nothing here would be indistinguishable from having no
    // data, and absence of data is itself a scientific claim -- say so.
    const channels = Array.isArray(data.channels) ? data.channels.length : 0;
    return html`<p class="psy-arch__evidence-error">
      ${t("archive.chartUnavailable", {
        channels: String(channels),
        points: String(timeline.length),
      })}
    </p>`;
  }

  private renderFeatureTable(summary: Record<string, unknown>) {
    const entries = Object.entries(summary).filter(
      ([, v]) => typeof v === "number" || typeof v === "string",
    );
    if (entries.length === 0) return null;
    return html`<ul class="psy-arch__list">
      ${entries.map(([k, v]) => html`<li>${k}: ${String(v)}</li>`)}
    </ul>`;
  }

  /**
   * Inline SVG, no chart library, no build step. `sharedScale` means the
   * series share a real unit (band_powers, 0-1) and so share one axis;
   * otherwise each series is a bag of numeric keys in unknown units --
   * plotting bpm against g on one axis would misstate their relative
   * magnitude -- so each scales to its own max, and the caption says which
   * happened.
   *
   * Provenance is baked into the SVG's own text, not just page chrome
   * around it: a chart travels by screenshot, arriving somewhere with no
   * page around it and nothing to say which Edition it came from or
   * whether a participant was ever involved. A caveat in a banner above the
   * figure does not survive that trip; one inside the figure does.
   */
  private renderSparkline(rows: Array<Record<string, number>>, sharedScale: boolean) {
    const width = 560;
    const height = 140;
    const padX = 8;
    const padY = 12;
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const colors = ["var(--accent)", "#eebc4a", "#7ec4cf", "#c98bda", "#e0846b", "#8bd17c"];
    const sharedMax = sharedScale
      ? Math.max(...rows.flatMap((r) => keys.map((k) => r[k] ?? 0)), 1e-6)
      : 0;
    const maxOf = (k: string) =>
      sharedScale ? sharedMax : Math.max(...rows.map((r) => r[k] ?? 0), 1e-6);
    const n = rows.length;
    const x = (i: number) => padX + (n <= 1 ? 0 : (i / (n - 1)) * (width - 2 * padX));
    const y = (v: number, max: number) => height - padY - (v / max) * (height - 2 * padY);

    const showProvenance = this.packet?.simulated === true && this.edition;

    return html`
      <div class="psy-arch__packet-chart">
        <svg
          viewBox="0 0 ${width} ${height + (showProvenance ? 16 : 0)}"
          class="psy-arch__packet-chart-svg"
          role="img"
        >
          ${keys.map((k) => {
            const max = maxOf(k);
            const d = rows
              .map(
                (r, i) =>
                  `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(r[k] ?? 0, max).toFixed(1)}`,
              )
              .join(" ");
            return html`<path
              d=${d}
              fill="none"
              stroke=${colors[keys.indexOf(k) % colors.length]}
              stroke-width="1.5"
            />`;
          })}
          ${showProvenance
            ? html`<text x="4" y="${height + 12}" class="psy-arch__packet-chart-provenance">
                ${t("archive.chartProvenance", { edition: this.edition?.editionId ?? "" })}
              </text>`
            : nothing}
        </svg>
        <div class="psy-arch__tree-related">
          ${keys.map(
            (k, i) => html`<span class="psy-arch__tree-related-chip"
              ><span
                class="psy-arch__packet-chart-swatch"
                style=${`background:${colors[i % colors.length]}`}
              ></span
              >${k}</span
            >`,
          )}
        </div>
        <p class="psy-arch__evidence-provenance">
          ${sharedScale ? t("archive.chartSharedScale") : t("archive.chartOwnScale")}
        </p>
      </div>
    `;
  }

  /**
   * Follow a `related` edge. The target may not be in the current grid (a
   * search can be filtered), so this fetches by id and synthesises the card
   * fields from the record rather than assuming a local lookup succeeds.
   */
  private async openById(id: string) {
    this.family = null;
    this.packet = null;
    this.closeEditionInfo();
    this.detail = null;
    this.evidence = null;
    this.evidenceError = null;
    const body = await this.get(`?id=${encodeURIComponent(id)}`);
    const record = body?.record as Record<string, unknown> | undefined;
    if (!record) return;
    this.selected = archetypeFromRaw(record, id);
    this.detail = record;
    void this.loadEvidence(id);
  }
}
