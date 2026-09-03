/**
 * "Ways to open this Node" — the card, on demand.
 *
 * The card appears by itself once, on the first launch after an install. That
 * is one moment in a Node's life, and it depends on a gate that has to hold a
 * credential, win a race with the app shell, and read a per-install flag, all
 * on exactly the right page load. Every one of those has failed at least once.
 *
 * This is the answer to that fragility: whatever the gate does, the options are
 * always one click away. It also covers the honest cases the gate cannot -- a
 * user who dismissed the card and changed their mind, one who opens their Node
 * in a second browser, or one who simply forgot how to get back in.
 */
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { t } from "../i18n/index.ts";

@customElement("psyntient-handy-badge")
export class PsyntientHandyBadge extends LitElement {
  // Light DOM: inherits the sidebar's footer styling like its siblings.
  protected override createRenderRoot() {
    return this;
  }

  @state() private busy = false;

  private async open() {
    this.busy = true;
    try {
      // Same lazily-loaded module the gate uses; it is already built as its own
      // chunk, so this costs nothing until someone asks for it.
      await import("../pages/onboarding/handoff-card.ts");
      const existing = document.querySelector("psyntient-handoff");
      if (existing) {
        return;
      }
      const card = document.createElement("psyntient-handoff") as HTMLElement & {
        persistDismissal?: boolean;
      };
      // Opened on purpose: closing it again must not silence the first-run card.
      card.persistDismissal = false;
      document.body.appendChild(card);
    } finally {
      this.busy = false;
    }
  }

  override render() {
    // Deliberately the update badge's classes, not new ones.
    //
    // It is the same kind of control in the same slot -- a nav-rail-sized pill
    // that opens something larger -- so it should be indistinguishable from its
    // neighbour, and duplicating the rules under a new name would only let the
    // two drift apart. It also keeps this off the startup stylesheet, which is
    // within a couple of hundred bytes of its budget.
    return html`
      <div class="psy-update">
        <button
          type="button"
          class="psy-update__btn"
          aria-haspopup="dialog"
          ?disabled=${this.busy}
          @click=${() => void this.open()}
          title=${t("onboarding.handyTitle")}
        >
          <span>${t("onboarding.handyBadge")}</span>
        </button>
      </div>
    `;
  }
}
