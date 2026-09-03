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
import { customElement, property, state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";

const SEEN_PREFIX = "psyntient.handy.seen.v1";
const STYLE_ID = "psyntient-handoff-style";

/**
 * Scoped to the install, not just the browser.
 *
 * localStorage is keyed by origin, and every install of this Node is the same
 * origin -- so a bare flag meant that dismissing the card once silenced it for
 * every future install on that machine. Reinstalling from scratch produced a
 * Node that had never shown the card and never would.
 *
 * Keying on the installer's timestamp makes each install ask the question
 * again, which is the honest answer to "has this Node offered you a way back
 * in yet?". A Node with no timestamp (a manual checkout) falls back to a shared
 * key; there is no install event to scope to, and re-offering on every launch
 * would be worse than remembering.
 */
function seenKey(installedAt: string | null): string {
  return installedAt ? `${SEEN_PREFIX}:${installedAt}` : SEEN_PREFIX;
}

/** Deliberately forgiving: a storage failure shows the card. */
function alreadySeen(installedAt: string | null): boolean {
  try {
    return localStorage.getItem(seenKey(installedAt)) === "1";
  } catch {
    return false;
  }
}

function markSeen(installedAt: string | null) {
  try {
    localStorage.setItem(seenKey(installedAt), "1");
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
  @state() private copied = false;

  /** The install this card belongs to; scopes the dismissal. */
  @property({ attribute: false }) installedAt: string | null = null;

  /**
   * Whether dismissing this card should stop it appearing on its own.
   *
   * False when the user opened it deliberately from the sidebar. Closing
   * something you went looking for should not silence the thing that would
   * have offered it to you anyway -- that would make the button a trap, where
   * looking at your options costs you the reminder.
   */
  @property({ attribute: false }) persistDismissal = true;

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
    if (this.persistDismissal) {
      markSeen(this.installedAt);
    }
    this.remove();
  }

  /** The address of this Node, which is what every option here is really about. */
  private get nodeUrl(): string {
    return `${location.origin}${location.pathname}`;
  }

  private async copyLink() {
    try {
      await navigator.clipboard.writeText(this.nodeUrl);
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
    } catch {
      // Clipboard permission can be refused; the address is on screen in the
      // bar above regardless, so this is a convenience rather than the only way.
    }
  }

  /**
   * Saves a .webloc/.url file that opens the Node.
   *
   * A real file the user can drop on their desktop, which is what "keep a link
   * handy" means to most people. The installer's app shortcut does more (it
   * starts the Node if it is not running), so this is offered alongside it
   * rather than instead of it.
   */
  private saveLink() {
    const mac = this.isMac;
    const body = mac
      ? `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>URL</key><string>${this.nodeUrl}</string></dict></plist>\n`
      : `[InternetShortcut]\r\nURL=${this.nodeUrl}\r\n`;
    const blob = new Blob([body], { type: mac ? "application/xml" : "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = mac ? "Psyntient Node.webloc" : "Psyntient Node.url";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  private get isMac() {
    return /mac/i.test(navigator.platform || navigator.userAgent);
  }

  /**
   * Which browser we are, only enough to say what to do instead.
   *
   * There is no way to install a web app without `beforeinstallprompt`, and
   * browsers fire it only when they are actually willing -- so when it has not
   * fired there is no button worth drawing, and the honest thing is to say why.
   * "Why" differs enough between browsers to be worth getting right: Safari can
   * do it from a menu, Firefox cannot do it at all, and Chrome usually has not
   * offered because the app is already installed.
   */
  private get pwaHint(): "safari" | "firefox" | "other" {
    const ua = navigator.userAgent;
    if (/firefox/i.test(ua)) return "firefox";
    if (/safari/i.test(ua) && !/chrome|chromium|edg/i.test(ua)) return "safari";
    return "other";
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
                    : this.pwaHint === "other"
                      ? t("onboarding.handyChoice.appUnavailable")
                      : t(`onboarding.handyManual.${this.pwaHint}`)}
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
              <button class="psy-handoff__action" @click=${() => void this.copyLink()}>
                ${this.copied
                  ? t("onboarding.handyChoice.copied")
                  : t("onboarding.handyChoice.bookmarkAction")}
              </button>
            </li>

            <li class="psy-handoff__item">
              <div class="psy-handoff__text">
                <strong>${t("onboarding.handyChoice.shortcutTitle")}</strong>
                <span>${t("onboarding.handyChoice.shortcutBody")}</span>
              </div>
              <button class="psy-handoff__action" @click=${() => this.saveLink()}>
                ${t("onboarding.handyChoice.shortcutAction")}
              </button>
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

/** True when this browser has not yet been offered a way back into THIS install. */
export function handoffNeeded(installedAt: string | null): boolean {
  return !alreadySeen(installedAt);
}
