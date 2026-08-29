// Update indicator for the sidebar footer.
//
// Shows nothing when the Node is current: an always-present "up to date" chip
// is noise, and the only moment this matters is when there is something to
// install.
//
// WHY THE CHECK IS NOT SCHEDULED
// Updates are user-initiated. With auto-update on, the check runs when the app
// loads -- which is also the moment a Gateway restart brings the page back, so
// the loop guard matters. That guard lives in daemon/updater.mjs and is by
// recorded target rather than by trying to detect a relaunch: a successful
// update makes local HEAD equal remote, so nothing is offered on the next
// load. Only a failed update could repeat, and failures record their sha and
// are not retried automatically.
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { t } from "../i18n/index.ts";

type UpdatePlan = {
  buildOpenclaw: string | null;
  buildUi: boolean;
  restart: boolean;
  reasons: string[];
};

type UpdateStatus = {
  ok?: boolean;
  upToDate?: boolean;
  current?: string;
  target?: string;
  commits?: string[];
  openclawCommits?: string[];
  stat?: string;
  plan?: UpdatePlan;
  dirty?: boolean;
  failedBefore?: boolean;
  error?: string;
  state?: { autoUpdate?: boolean; lastCheckAt?: string | null };
};

const ROUTE = "/__openclaw__/psyntient/update";

@customElement("psyntient-update-badge")
export class PsyntientUpdateBadge extends LitElement {
  // Light DOM: inherits the app's theme tokens rather than duplicating them.
  protected override createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) authToken: string | null = null;

  @state() private status: UpdateStatus | null = null;
  @state() private open = false;
  @state() private applying = false;
  @state() private stage: string | null = null;
  @state() private pct = 0;
  @state() private result: { ok: boolean; error?: string } | null = null;

  override connectedCallback() {
    super.connectedCallback();
    if (this.authToken) void this.load();
  }

  override updated(changed: Map<string, unknown>) {
    // The token is not committed on first connect; retry once it arrives.
    if (changed.has("authToken") && this.authToken && !this.status) {
      void this.load();
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json" };
    if (this.authToken) h.Authorization = `Bearer ${this.authToken}`;
    return h;
  }

  /** Never throws: an offline Node must not break the sidebar. */
  private async load() {
    try {
      const res = await fetch(ROUTE, { headers: this.headers() });
      if (!res.ok) return;
      this.status = (await res.json()) as UpdateStatus;
    } catch {
      // Offline, or no remote configured. Both are normal; stay silent.
    }
  }

  private async setAuto(enabled: boolean) {
    try {
      await fetch(ROUTE, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auto", enabled }),
      });
      this.status = { ...this.status, state: { ...this.status?.state, autoUpdate: enabled } };
    } catch {
      // Leave the toggle where it was rather than lying about the new state.
    }
  }

  private async applyUpdate() {
    if (this.applying) return;
    this.applying = true;
    this.result = null;
    this.pct = 0;
    this.stage = t("update.starting");

    try {
      const res = await fetch(ROUTE, {
        method: "POST",
        headers: { ...this.headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ action: "apply" }),
      });
      if (!res.ok || !res.body) {
        this.result = { ok: false, error: t("update.failed") };
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
            this.stage = t(`update.stage.${payload.stage}`, { detail: payload.detail ?? "" });
            if (typeof payload.pct === "number") this.pct = payload.pct;
          } else if (name === "result") {
            this.result = payload;
            this.pct = 100;
          }
        }
      }
    } catch (err) {
      this.result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.applying = false;
      this.stage = null;
      await this.load();
    }
  }

  private renderPanel() {
    const s = this.status;
    if (!s) return nothing;
    const plan = s.plan;
    return html`
      <div class="psy-update__panel" role="dialog" aria-label=${t("update.title")}>
        <h4>${t("update.available")}</h4>
        <p class="psy-update__summary">
          ${t("update.commitCount", {
            n: String((s.commits?.length ?? 0) + (s.openclawCommits?.length ?? 0)),
          })}
          ${s.stat ? html`· ${s.stat}` : nothing}
        </p>
        ${(s.commits ?? []).slice(0, 5).map((c) => html`<p class="psy-update__commit">${c}</p>`)}
        ${plan
          ? html`<p class="psy-update__plan">
              ${plan.reasons.join("; ")}${plan.restart ? ` · ${t("update.willRestart")}` : ""}
              ${plan.buildOpenclaw === "full" ? ` · ${t("update.longBuild")}` : ""}
            </p>`
          : nothing}
        ${s.dirty ? html`<p class="psy-update__warn">${t("update.dirty")}</p>` : nothing}
        ${s.failedBefore
          ? html`<p class="psy-update__warn">${t("update.failedBefore")}</p>`
          : nothing}
        ${this.applying
          ? html`<div class="psy-update__progress">
              <div class="psy-update__track">
                <div class="psy-update__fill" style=${`width:${this.pct}%`}></div>
              </div>
              <p class="psy-update__stage">${this.stage}</p>
            </div>`
          : html`<button
              type="button"
              class="psy-update__go"
              ?disabled=${s.dirty === true}
              @click=${() => void this.applyUpdate()}
            >
              ${t("update.install")}
            </button>`}
        ${this.result && !this.result.ok
          ? html`<p class="psy-update__warn">${this.result.error}</p>`
          : nothing}

        <label class="psy-update__auto">
          <input
            type="checkbox"
            .checked=${this.status?.state?.autoUpdate === true}
            @change=${(e: Event) => void this.setAuto((e.target as HTMLInputElement).checked)}
          />
          <span>${t("update.autoLabel")}</span>
        </label>
        <p class="psy-update__hint">${t("update.autoHint")}</p>
      </div>
    `;
  }

  override render() {
    const s = this.status;
    // Silent when current, unreachable, or still loading: the chip exists to
    // announce that something is waiting, not to report routine health.
    if (!s || s.ok === false || s.upToDate !== false) return nothing;

    return html`
      <div class="psy-update">
        <button
          type="button"
          class="psy-update__chip"
          aria-expanded=${String(this.open)}
          @click=${() => (this.open = !this.open)}
        >
          <span class="psy-update__dot psy-aura" aria-hidden="true"></span>
          <span
            >${this.applying
              ? t("update.installing")
              : t("update.chip", {
                  n: String((s.commits?.length ?? 0) + (s.openclawCommits?.length ?? 0)),
                })}</span
          >
        </button>
        ${this.open ? this.renderPanel() : nothing}
      </div>
    `;
  }
}
