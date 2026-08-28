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
// WHAT IT DOES NOT DRAW
// No relationship graph, no clustering, no similarity layout. The Archive
// currently exposes 25 archetypes and zero packets or mappings, so any edge
// drawn between two archetypes would be invented. The visual encodes only what
// the data actually says: how established an archetype is (tier) and how much
// evidence stands behind it (exemplars). When mappings exist, this is where
// they would go.
//
// It is a reading surface. Questions hand off to Cortex rather than growing an
// analysis tool here.
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";

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

const ROUTE = "/__openclaw__/psyntient/archive";

/** Tier drives the visual weight; unknown tiers fall back rather than vanish. */
const TIER_ORDER = ["established", "emerging", "tentative"];

function tierOf(a: Archetype): string {
  return (a.confidenceTier ?? a.confidence_tier ?? "tentative").toLowerCase();
}
function exemplarsOf(a: Archetype): number {
  return a.exemplars ?? a.n_exemplars ?? 0;
}

@customElement("psyntient-archive-page")
export class PsyntientArchivePage extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  @state() private edition: Edition | null = null;
  @state() private archetypes: Archetype[] = [];
  @state() private selected: Archetype | null = null;
  @state() private detail: Record<string, unknown> | null = null;
  @state() private query = "";
  @state() private loading = true;
  @state() private errorText: string | null = null;

  private authToken(): string | null {
    return new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
  }

  private async get(params = ""): Promise<Record<string, unknown> | null> {
    const token = this.authToken();
    try {
      const res = await fetch(`${ROUTE}${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
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

  private async runSearch() {
    const q = this.query.trim();
    if (!q) {
      void this.load();
      return;
    }
    this.loading = true;
    const body = await this.get(`?query=${encodeURIComponent(q)}`);
    this.loading = false;
    if (!body || body.ok === false) return;
    this.archetypes = (body.archetypes as Archetype[]) ?? [];
  }

  private async open(a: Archetype) {
    this.selected = a;
    this.detail = null;
    const body = await this.get(`?id=${encodeURIComponent(a.id)}`);
    if (body?.ok !== false) {
      this.detail = (body?.record as Record<string, unknown>) ?? null;
    }
  }

  /** Hand the question to Cortex rather than answering it here. */
  private askCortex(a: Archetype) {
    const prompt = `Tell me about the "${a.name}" archetype in the Noetic Archive, and what the evidence behind it looks like.`;
    location.href = `/new?prompt=${encodeURIComponent(prompt)}`;
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

  override render() {
    const sorted = [...this.archetypes].sort((a, b) => {
      const ta = TIER_ORDER.indexOf(tierOf(a));
      const tb = TIER_ORDER.indexOf(tierOf(b));
      // Best-established first, then best-supported: the reader's first
      // question is "what does this Archive actually know", not "what is
      // alphabetically first".
      return (ta === -1 ? 99 : ta) - (tb === -1 ? 99 : tb) || exemplarsOf(b) - exemplarsOf(a);
    });

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
              if (e.key === "Enter") void this.runSearch();
            }}
          />
          <button type="button" @click=${() => this.runSearch()}>${t("archive.search")}</button>
        </div>

        ${this.loading
          ? html`<p class="psy-arch__loading">${t("archive.loading")}</p>`
          : html`<div class="psy-arch__grid">${sorted.map((a) => this.renderCard(a))}</div>`}
        ${this.selected ? this.renderDetail(this.selected) : nothing}
      </div>
    `;
  }

  private renderDetail(a: Archetype) {
    return html`
      <div class="psy-arch__detail" role="dialog" aria-modal="true">
        <div class="psy-arch__detail-panel">
          <button
            type="button"
            class="psy-arch__close"
            aria-label=${t("archive.close")}
            @click=${() => {
              this.selected = null;
              this.detail = null;
            }}
          >
            ×
          </button>
          <span class="psy-arch__tier psy-arch__tier--${tierOf(a)}">${tierOf(a)}</span>
          <h2 class="psy-arch__detail-name">${a.name}</h2>
          <p class="psy-arch__detail-desc">${a.description}</p>
          <p class="psy-arch__detail-id"><code>${a.id}</code></p>
          <button class="psy-arch__ask" type="button" @click=${() => this.askCortex(a)}>
            ${t("archive.askCortex")}
          </button>
          ${this.detail
            ? html`<pre class="psy-arch__raw">${JSON.stringify(this.detail, null, 2)}</pre>`
            : html`<p class="psy-arch__loading">${t("archive.loading")}</p>`}
        </div>
      </div>
    `;
  }
}
