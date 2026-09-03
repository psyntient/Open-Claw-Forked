/**
 * The one screen that genuinely has to live in the app.
 *
 * WHY THIS EXISTS AT ALL
 * The installer does the whole setup -- model key, account pairing, install,
 * service -- and waits until the Node answers `readyz` before opening a
 * browser. Exactly one thing it cannot do is offer to install the Node as an
 * app: browsers fire `beforeinstallprompt` only on the page's own origin, and
 * the installer serves its wizard from a different port. So this card, and
 * nothing else, is the app's share of setup.
 *
 * WHY IT IS AN OVERLAY AND NOT A WIZARD
 * The previous version replaced document.body with a four-step wizard that
 * re-derived what the installer had already done, then skipped the steps it
 * found finished. Three separate failures came out of that machinery, all of
 * them invisible to the user, who simply landed in the chat window:
 *
 *  - its status call was a plugin route wanting the gateway secret, which the
 *    browser deliberately does not keep;
 *  - reading that secret from the URL hash lost a race with the app shell,
 *    which trades it for a device token and clears it;
 *  - and replacing document.body raced the app shell's own mount, so which one
 *    the user saw depended on which finished last.
 *
 * An overlay has none of those. It is appended over a working app rather than
 * replacing it, so there is nothing to race. It needs no credential, because
 * everything it must know now arrives in the bootstrap config the loader has
 * already fetched. And it decides nothing -- it cannot "skip", because there
 * are no steps to skip.
 *
 * WHY DISMISSAL IS IN localStorage
 * Not on the server, though the marker still exists for the installer's sake.
 * A bookmark and an installed app are per-browser facts; a user who opens
 * their Node in a second browser has genuinely not put it anywhere handy
 * there yet, and should be offered the choice again. Writing it server-side
 * would also mean an authenticated POST, which is the class of thing this
 * rewrite exists to remove.
 */
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";

const SEEN_KEY = "psyntient.handy.seen.v1";
const STYLE_ID = "psyntient-handoff-style";

/** Per-browser, and deliberately forgiving: a storage failure shows the card. */
function alreadySeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Private windows and blocked storage both land here. Showing the card
    // again next launch is a far better failure than throwing on dismissal.
  }
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.psy-handoff {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: grid;
  place-items: center;
  padding: 1.5rem;
  background: rgba(6, 5, 18, 0.72);
  backdrop-filter: blur(6px);
}
.psy-handoff__card {
  width: min(30rem, 100%);
  max-height: 100%;
  overflow-y: auto;
  padding: 1.6rem 1.5rem 1.35rem;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  background: #12102a;
  color: #f4f2ff;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
  font: inherit;
}
.psy-handoff__title { margin: 0 0 0.4rem; font-size: 1.25rem; font-weight: 600; }
.psy-handoff__body { margin: 0 0 1.1rem; font-size: 0.9rem; line-height: 1.5; opacity: 0.72; }
.psy-handoff__list { list-style: none; margin: 0 0 1.1rem; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
.psy-handoff__item {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}
.psy-handoff__text { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
.psy-handoff__text strong { font-size: 0.92rem; font-weight: 600; }
.psy-handoff__text span { font-size: 0.82rem; line-height: 1.4; opacity: 0.66; }
.psy-handoff__action {
  flex: none; white-space: nowrap; cursor: pointer;
  padding: 0.45rem 0.8rem; font: inherit; font-size: 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 8px;
  background: transparent; color: inherit;
}
.psy-handoff__action:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); }
.psy-handoff__action:disabled { opacity: 0.5; cursor: default; }
.psy-handoff__done {
  width: 100%; cursor: pointer;
  padding: 0.6rem 1rem; font: inherit; font-size: 0.92rem; font-weight: 600;
  border: 0; border-radius: 9px;
  background: #eebc4a; color: #1a1400;
}
@media (max-width: 460px) {
  .psy-handoff__item { flex-direction: column; align-items: stretch; }
}
`;
  document.head.appendChild(style);
}

@customElement("psyntient-handoff")
export class PsyntientHandoff extends LitElement {
  // Light DOM: the card is a plain overlay and inherits the app's fonts.
  protected override createRenderRoot() {
    return this;
  }

  @state() private canInstall = false;
  @state() private busy = false;

  private installEvent: (Event & { prompt: () => Promise<void> }) | null = null;

  override connectedCallback() {
    super.connectedCallback();
    ensureStyles();
    window.addEventListener("psy-install-available", this.adopt);
    window.addEventListener("psy-install-done", this.adopt);
    this.adopt();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("psy-install-available", this.adopt);
    window.removeEventListener("psy-install-done", this.adopt);
  }

  /** index.html stashes the prompt, which fires before any module evaluates. */
  private adopt = () => {
    const stashed = (globalThis as { __psyInstallPrompt?: Event & { prompt: () => Promise<void> } })
      .__psyInstallPrompt;
    this.installEvent = stashed ?? null;
    this.canInstall = stashed != null;
  };

  private async install() {
    if (!this.installEvent) return;
    this.busy = true;
    try {
      await this.installEvent.prompt();
      // One prompt per event, accepted or not. Clear the stash too, or a
      // remount would offer a spent prompt.
      (globalThis as { __psyInstallPrompt?: unknown }).__psyInstallPrompt = null;
      this.installEvent = null;
      this.canInstall = false;
    } finally {
      this.busy = false;
    }
  }

  private dismiss() {
    markSeen();
    this.remove();
  }

  private get isMac() {
    return /mac/i.test(navigator.platform || navigator.userAgent);
  }

  override render() {
    const bookmarkKey = this.isMac ? "⌘ D" : "Ctrl + D";
    return html`
      <div
        class="psy-handoff"
        role="dialog"
        aria-modal="true"
        aria-label=${t("onboarding.handyTitle")}
      >
        <div class="psy-handoff__card">
          <h2 class="psy-handoff__title">${t("onboarding.handyTitle")}</h2>
          <p class="psy-handoff__body">${t("onboarding.handyBody")}</p>

          <ul class="psy-handoff__list">
            <li class="psy-handoff__item">
              <div class="psy-handoff__text">
                <strong>${t("onboarding.handyChoice.appTitle")}</strong>
                <span>
                  ${this.canInstall
                    ? t("onboarding.handyChoice.appBody")
                    : t("onboarding.handyManual.other")}
                </span>
              </div>
              ${this.canInstall
                ? html`<button
                    class="psy-handoff__action"
                    ?disabled=${this.busy}
                    @click=${() => void this.install()}
                  >
                    ${t("onboarding.installApp")}
                  </button>`
                : nothing}
            </li>

            <li class="psy-handoff__item">
              <div class="psy-handoff__text">
                <strong>${t("onboarding.handyChoice.bookmarkTitle")}</strong>
                <span>${t("onboarding.handyChoice.bookmarkBody", { key: bookmarkKey })}</span>
              </div>
            </li>

            <li class="psy-handoff__item">
              <div class="psy-handoff__text">
                <strong>${t("onboarding.handyChoice.shortcutTitle")}</strong>
                <span>${t("onboarding.handyChoice.shortcutBody")}</span>
              </div>
            </li>
          </ul>

          <button class="psy-handoff__done" @click=${() => this.dismiss()}>
            ${t("onboarding.enter")}
          </button>
        </div>
      </div>
    `;
  }
}

/** True when this browser has not yet been offered a way back in. */
export function handoffNeeded(): boolean {
  return !alreadySeen();
}
