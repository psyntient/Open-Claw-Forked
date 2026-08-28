// Sync progress, in the sidebar footer where it is visible from every screen.
//
// Sits beside the Vault badge deliberately: both answer "what is happening to
// my data right now", and a contribution to the Archive is the one action in
// this product that leaves the user's machine irreversibly. It should never be
// something you have to go and look for.
//
// Determinate, not a spinner. archive-sync.mjs knows the packet count before
// the first request, so the bar shows real position rather than implying
// unknown work. Idle renders nothing at all -- ambient chrome that is always
// visible teaches people to stop seeing it.
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { t } from "../i18n/index.ts";
import { loadSyncState, type SyncRun } from "../lib/psyntient-sync.ts";

/** Fast enough to look live, slow enough not to hammer the gateway. */
const POLL_ACTIVE_MS = 1_000;
/** While idle, just often enough to notice a run someone else started. */
const POLL_IDLE_MS = 15_000;

@customElement("psyntient-sync-badge")
export class PsyntientSyncBadge extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) authToken: string | null = null;

  @state() private run: SyncRun | null = null;
  /** Kept briefly after a run ends so the outcome is not missed. */
  @state() private finished: SyncRun | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;

  override connectedCallback() {
    super.connectedCallback();
    void this.poll();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has("authToken") && this.authToken) {
      void this.poll();
    }
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    // setTimeout after each response, not setInterval: a slow gateway must not
    // stack overlapping requests behind a fixed tick.
    this.timer = setTimeout(() => void this.poll(), ms);
  }

  private async poll() {
    const state = await loadSyncState(this.authToken);
    const active = state.active;
    if (active && !active.done) {
      this.run = active;
      this.finished = null;
      this.schedule(POLL_ACTIVE_MS);
      return;
    }
    if (active?.done && this.run) {
      // Only show a result for a run this badge actually watched, so a stale
      // completed run does not reappear as fresh news on every page load.
      this.finished = active;
      this.run = null;
      setTimeout(() => {
        this.finished = null;
      }, 8_000);
    } else {
      this.run = null;
    }
    this.schedule(POLL_IDLE_MS);
  }

  override render() {
    if (this.run) {
      const total = Math.max(this.run.total, 1);
      const pct = Math.round((this.run.index / total) * 100);
      return html`
        <div class="psy-sync" role="status" aria-live="polite">
          <div class="psy-sync__row">
            <span class="psy-sync__dot" aria-hidden="true"></span>
            <span class="psy-sync__label"
              >${t("sync.inProgress", { done: String(this.run.index), total: String(total) })}</span
            >
          </div>
          <div
            class="psy-sync__track"
            role="progressbar"
            aria-valuenow=${this.run.index}
            aria-valuemin="0"
            aria-valuemax=${total}
          >
            <div class="psy-sync__fill" style=${`width:${pct}%`}></div>
          </div>
        </div>
      `;
    }
    if (this.finished) {
      const failed = this.finished.error || (this.finished.result?.failed ?? 0) > 0;
      return html`
        <div class="psy-sync psy-sync--${failed ? "error" : "done"}" role="status">
          <span class="psy-sync__label">
            ${this.finished.error
              ? this.finished.error
              : // "Queued", never "contributed": the Architect reviews the
                // queue and may reject, and accepted packets only appear in a
                // later Edition.
                t("sync.queued", { count: String(this.finished.result?.submitted ?? 0) })}
          </span>
        </div>
      `;
    }
    return nothing;
  }
}
