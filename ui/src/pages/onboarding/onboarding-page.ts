// Psyntient onboarding wizard, ported from the WebClaw build.
//
// Steps: welcome -> key -> pairing -> vault -> install. This is OUR wizard,
// not OpenClaw's model-setup page: that one covers only the key step, speaks
// in OpenClaw's voice, and leads with 5 GB local-model downloads.
//
// WHY LIT AND NOT THE ORIGINAL REACT APP
// The React version's four calls (/api/onboarding, /api/provider-key,
// /api/pairing, /api/vault) are TanStack Start *server* routes that only
// exist while WebClaw's server runs. Reusing it would have meant keeping the
// entire stack Path C retires, on a second origin. The data layer had to be
// rewritten either way, so only the markup was genuinely reusable -- and that
// is preserved here, including the psy-morph stepper.
//
// THE AUTH PROTOCOL IS UNCHANGED. This calls the same daemon entry points the
// CLI does; daemon/pairing.mjs is untouched. See daemon/docs/AUTH_FLOW.md.
//
// Non-negotiables from CLAUDE.md:
//  - Pairing is REQUIRED, never skippable. It will gate subscription tier, so
//    a Node that never paired could never be gated on entitlement. Failure
//    offers "Try again" only -- never a way past.
//  - Pairing and the LLM key stay decoupled: a bad key must never surface as
//    an account problem, or vice versa.
//  - The status check is expensive (hasAnyProvider shells out to the CLI at
//    ~10s), so it runs ONCE on mount and never per render.
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { t } from "../../i18n/index.ts";

export type OnboardingStep = "welcome" | "key" | "pairing" | "handy";

/** The stepper shows every step; none are collapsed or hidden. */
/**
 * The Vault step is gone on purpose. It used to ask where the Vault should
 * live, or whether to use cloud storage. Vaults are always local now and cloud
 * is backup, so that step presented a choice that no longer exists -- the Vault
 * path is a line on the final screen instead.
 */
const STEPS: readonly OnboardingStep[] = ["welcome", "key", "pairing", "handy"];

type Status = {
  hasProvider?: boolean;
  isPaired?: boolean;
  completed?: boolean;
  /** True when the installer handed off to this app. */
  viaInstaller?: boolean;
};
type Provider = { id: string; label?: string };

const ROUTES = {
  onboarding: "/__openclaw__/psyntient/onboarding",
  key: "/__openclaw__/psyntient/provider-key",
  pairing: "/__openclaw__/psyntient/pairing",
  vault: "/__openclaw__/psyntient/vault",
};

/**
 * Resume point. Vault is not a real gate -- the local Vault activates on its
 * own -- and `completed` is a one-time "seen it" marker rather than derived
 * state, so it is checked last.
 */
export function resumeStepFor(status: Status): OnboardingStep {
  if (!status.hasProvider) return "welcome";
  if (!status.isPaired) return "pairing";
  return "handy";
}

@customElement("psyntient-onboarding")
export class PsyntientOnboarding extends LitElement {
  // Light DOM so the page inherits the Psyntient theme tokens.
  protected override createRenderRoot() {
    return this;
  }

  @state() private step: OnboardingStep | null = null;
  @state() private providers: Provider[] = [];
  @state() private providerId = "";
  @state() private apiKey = "";
  @state() private busy = false;
  @state() private errorText: string | null = null;
  @state() private vaultPath: string | null = null;
  /** True when the installer handed off to this app, so setup continues its
   *  numbering instead of restarting at step one. */
  @state() private viaInstaller = false;
  /** What was already true on arrival. Drives which steps the stepper shows
   *  as already done rather than as work still to come. */
  @state() private hadProvider = false;
  @state() private wasPaired = false;

  private authToken: string | null = null;

  override connectedCallback() {
    super.connectedCallback();
    window.addEventListener("psy-install-available", this.adoptInstallPrompt);
    window.addEventListener("psy-install-done", this.adoptInstallPrompt);
    // The event may already have fired and been stashed before this mounted.
    this.adoptInstallPrompt();
    this.authToken = new URLSearchParams(location.hash.replace(/^#/, "")).get("token");
    void this.bootstrap();
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  /** Runs once on mount. The provider check inside is the expensive part. */
  private async bootstrap() {
    try {
      const res = await fetch(ROUTES.onboarding, { headers: this.headers() });
      const status = (await res.json()) as Status;
      this.viaInstaller = status.viaInstaller === true;
      this.hadProvider = status.hasProvider === true;
      this.wasPaired = status.isPaired === true;
      this.step =
        status.completed && status.hasProvider && status.isPaired ? "handy" : resumeStepFor(status);
    } catch {
      this.step = "welcome";
    }
    void this.loadProviders();
  }

  private async loadProviders() {
    try {
      const res = await fetch(ROUTES.key, { headers: this.headers() });
      const body = (await res.json()) as { providers?: Provider[] };
      this.providers = body.providers ?? [];
      this.providerId = this.providers[0]?.id ?? "";
    } catch {
      this.providers = [];
    }
  }

  private async saveKey() {
    this.errorText = null;
    this.busy = true;
    try {
      const res = await fetch(ROUTES.key, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ providerId: this.providerId, apiKey: this.apiKey }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        tested?: { ok?: boolean; error?: string };
      };
      if (!body.ok) {
        throw new Error(body.error ?? t("onboarding.keySaveFailed"));
      }
      // A key that saves but cannot talk is worse than no key: it fails later,
      // inside a chat, where the cause is not obvious. Test before advancing.
      if (body.tested && body.tested.ok === false) {
        throw new Error(body.tested.error ?? t("onboarding.keyTestFailed"));
      }
      this.apiKey = "";
      this.step = "pairing";
    } catch (err) {
      this.errorText = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private async startPairing() {
    this.errorText = null;
    this.busy = true;
    try {
      const res = await fetch(ROUTES.pairing, { method: "POST", headers: this.headers() });
      const body = (await res.json()) as { ok?: boolean; isPaired?: boolean; error?: string };
      if (!body.ok || !body.isPaired) {
        throw new Error(body.error ?? t("onboarding.pairingFailed"));
      }
      this.step = "handy";
      void this.loadVault();
    } catch (err) {
      this.errorText = err instanceof Error ? err.message : String(err);
    } finally {
      this.busy = false;
    }
  }

  private async loadVault() {
    try {
      const res = await fetch(ROUTES.vault, { headers: this.headers() });
      const body = (await res.json()) as { path?: string };
      this.vaultPath = body.path ?? null;
    } catch {
      this.vaultPath = null;
    }
  }

  private async finish() {
    try {
      await fetch(ROUTES.onboarding, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ action: "complete" }),
      });
    } catch {
      // The completion marker is a convenience; never block entry on it.
    }
    location.reload();
  }

  /**
   * Chromium fires beforeinstallprompt only when it judges the app installable
   * AND the user has not already dismissed or installed it. So the button is
   * shown only once the event has actually arrived -- never on the assumption
   * that it will. A button that silently does nothing because the event never
   * fired is the same failure as the folder picker that opened behind the
   * window: an affordance that lies.
   */
  private installEvent: (Event & { prompt: () => Promise<void> }) | null = null;
  @state() private canInstallPwa = false;

  /** Which OS's shortcut location to name. */
  private get platform(): "mac" | "windows" | "linux" {
    const ua = navigator.userAgent;
    if (/Mac/.test(ua)) return "mac";
    if (/Win/.test(ua)) return "windows";
    return "linux";
  }

  /** Which manual instructions to show when there is no install prompt. */
  private get pwaHint(): "safari" | "firefox" | "other" {
    const ua = navigator.userAgent;
    if (/Firefox\//.test(ua)) return "firefox";
    if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "safari";
    return "other";
  }

  /**
   * Adopts the prompt captured in the document head.
   *
   * beforeinstallprompt fires ONCE, early -- usually before this app's modules
   * have been evaluated, let alone before this component mounts. A listener
   * added in connectedCallback registers after the event has come and gone,
   * which is why the final step used to offer no install button on browsers
   * that were perfectly willing to install. index.html stashes the event
   * instead; this picks it up whenever it arrives, before or after mount.
   */
  private adoptInstallPrompt = () => {
    const stashed = (globalThis as { __psyInstallPrompt?: Event & { prompt: () => Promise<void> } })
      .__psyInstallPrompt;
    this.installEvent = stashed ?? null;
    this.canInstallPwa = stashed != null;
  };

  private async installPwa() {
    if (!this.installEvent) return;
    this.busy = true;
    try {
      await this.installEvent.prompt();
      // Chromium allows one prompt per event; whether they accepted or not,
      // it cannot be reused. Clear the stash too, or a remount would offer a
      // spent prompt.
      (globalThis as { __psyInstallPrompt?: unknown }).__psyInstallPrompt = null;
      this.installEvent = null;
      this.canInstallPwa = false;
    } finally {
      this.busy = false;
    }
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("psy-install-available", this.adoptInstallPrompt);
    window.removeEventListener("psy-install-done", this.adoptInstallPrompt);
  }

  /**
   * Draws the whole journey, not just this app's share of it.
   *
   * Reached through the installer, setup is the CONTINUATION of one flow
   * rather than a second wizard beginning at step one -- somebody who has just
   * watched a twenty-minute install should not be welcomed again and told they
   * are at the beginning.
   *
   * The count is DERIVED from the pills drawn, never a constant. A hardcoded
   * "the installer did three steps" is what previously produced a bar showing
   * four pills above a label reading "Step 6 of 6", leaving the user to
   * reconcile the two.
   */
  private renderStepper() {
    const viaInstaller = this.viaInstaller;
    // Continuing an install, the stepper has to describe the WHOLE journey,
    // not just this app's share of it -- otherwise the bar shows four pills
    // while the label counts six, and the user is left to reconcile them.
    //
    // So the installer's completed steps become done pills here, and only
    // steps that genuinely remain are shown as upcoming. A step the installer
    // failed to complete is not marked done, so it never appears twice.
    const done: string[] = [];
    let steps: OnboardingStep[] = STEPS.filter((id) => id !== "welcome");
    if (viaInstaller) {
      if (this.hadProvider) {
        done.push(t("onboarding.stepDone.key"));
        steps = steps.filter((id) => id !== "key");
      }
      if (this.wasPaired) {
        done.push(t("onboarding.stepDone.pairing"));
        steps = steps.filter((id) => id !== "pairing");
      }
      done.push(t("onboarding.stepDone.installed"));
    } else {
      steps = [...STEPS];
    }

    const index = steps.indexOf(this.step ?? steps[0]!);
    const offset = done.length;
    const total = steps.length + offset;

    return html`
      <p class="psy-onb__count">
        ${t("onboarding.stepCount", {
          n: String(index + 1 + offset),
          total: String(total),
        })}
      </p>
      <ol class="psy-onb__stepper" aria-label=${t("onboarding.progress")}>
        ${done.map(
          (label) => html`
            <li class="psy-onb__step psy-onb__step--done">
              <span class="psy-onb__pip" aria-hidden="true"></span>
              <span class="psy-onb__step-label">${label}</span>
            </li>
          `,
        )}
        ${steps.map((id, i) => {
          const state = i < index ? "done" : i === index ? "active" : "upcoming";
          // A step names what is still to do while it is ahead, and what was
          // done once it is behind.
          const label =
            state === "done" ? t(`onboarding.stepDone.${id}`) : t(`onboarding.step.${id}`);
          return html`
            <li class="psy-onb__step psy-onb__step--${state}">
              <span class="psy-onb__pip" aria-hidden="true"></span>
              <span class="psy-onb__step-label">${label}</span>
            </li>
          `;
        })}
      </ol>
    `;
  }

  override render() {
    if (this.step === null) {
      return html`
        <div class="psy-onb">
          <p class="psy-onb__hint">${t("onboarding.checking")}</p>
        </div>
      `;
    }
    return html`
      <div class="psy-onb">
        <img
          class="psy-onb__mark"
          src="/brand/psyntient-mark-2026.png"
          alt=""
          width="112"
          height="112"
        />
        ${this.renderStepper()}
        <div class="psy-onb__body">${this.renderStep()}</div>
        ${this.errorText
          ? html`<p class="psy-onb__error" role="alert">${this.errorText}</p>`
          : nothing}
      </div>
    `;
  }

  private renderStep() {
    switch (this.step) {
      case "welcome":
        return html`
          <h1 class="psy-onb__title">${t("onboarding.welcomeTitle")}</h1>
          <p class="psy-onb__hint">${t("onboarding.welcomeBody")}</p>
          <button class="psy-onb__primary" @click=${() => (this.step = "key")}>
            ${t("onboarding.initialize")}
          </button>
        `;
      case "key":
        return html`
          <h1 class="psy-onb__title">${t("onboarding.keyTitle")}</h1>
          <p class="psy-onb__hint">${t("onboarding.keyBody")}</p>
          <select
            class="psy-onb__select"
            aria-label=${t("onboarding.provider")}
            .value=${this.providerId}
            @change=${(e: Event) => (this.providerId = (e.target as HTMLSelectElement).value)}
          >
            ${this.providers.map((p) => html`<option value=${p.id}>${p.label ?? p.id}</option>`)}
          </select>
          <input
            class="psy-onb__input"
            type="password"
            autocomplete="off"
            spellcheck="false"
            aria-label=${t("onboarding.keyPlaceholder")}
            placeholder=${t("onboarding.keyPlaceholder")}
            .value=${this.apiKey}
            @input=${(e: Event) => (this.apiKey = (e.target as HTMLInputElement).value)}
          />
          <button
            class="psy-onb__primary"
            ?disabled=${!this.apiKey || this.busy}
            @click=${() => this.saveKey()}
          >
            ${this.busy ? t("onboarding.testing") : t("onboarding.continue")}
          </button>
        `;
      case "pairing":
        // No skip. Pairing will gate subscription tier; a Node that never
        // paired could never be gated on entitlement.
        return html`
          <h1 class="psy-onb__title">${t("onboarding.pairingTitle")}</h1>
          <p class="psy-onb__hint">${t("onboarding.pairingBody")}</p>
          <button
            class="psy-onb__primary"
            ?disabled=${this.busy}
            @click=${() => this.startPairing()}
          >
            ${this.busy
              ? t("onboarding.pairingWaiting")
              : this.errorText
                ? t("onboarding.tryAgain")
                : t("onboarding.pairNow")}
          </button>
        `;
      case "handy":
        // The last step does something rather than announcing readiness. An
        // installed app, a desktop shortcut or a bookmark are the three ways
        // back in, and which are available depends on the browser -- so the
        // options are offered in order of how well they work, not as a list of
        // equals.
        return html`
          <h1 class="psy-onb__title">${t("onboarding.handyTitle")}</h1>
          <p class="psy-onb__hint">${t("onboarding.handyBody")}</p>

          ${this.canInstallPwa
            ? html`<button
                class="psy-onb__primary"
                ?disabled=${this.busy}
                @click=${() => void this.installPwa()}
              >
                ${t("onboarding.installApp")}
              </button>`
            : html`<p class="psy-onb__hint psy-onb__hint--quiet">
                ${t(`onboarding.handyManual.${this.pwaHint}`)}
              </p>`}

          <p class="psy-onb__hint psy-onb__hint--quiet">
            <!-- Only the installer creates a desktop shortcut. Saying so after
                 a manual checkout would send the user hunting for an icon that
                 was never written. -->
            ${this.viaInstaller
              ? html`${t("onboarding.handyShortcut")}
                ${t(`onboarding.shortcutWhere.${this.platform}`)}`
              : t("onboarding.handyNoShortcut")}
            ${this.vaultPath
              ? html`<span
                  >${t("onboarding.vaultLivesHere")}<br /><code class="psy-onb__path"
                    >${this.vaultPath}</code
                  ></span
                >`
              : nothing}
          </p>

          <!-- When no PWA install is on offer this is the only action on the
               page, and a secondary-styled button reads as disabled. -->
          <button
            class=${this.canInstallPwa ? "psy-onb__secondary" : "psy-onb__primary"}
            @click=${() => this.finish()}
          >
            ${t("onboarding.enter")}
          </button>
        `;
      default:
        return nothing;
    }
  }
}
