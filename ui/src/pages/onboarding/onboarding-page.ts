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

export type OnboardingStep = "welcome" | "key" | "pairing" | "vault" | "install";

/** All five steps. The stepper shows every one; none are collapsed or hidden. */
const STEPS: readonly OnboardingStep[] = ["welcome", "key", "pairing", "vault", "install"];

type Status = { hasProvider?: boolean; isPaired?: boolean; completed?: boolean };
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
  return "vault";
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

  private authToken: string | null = null;

  override connectedCallback() {
    super.connectedCallback();
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
      this.step =
        status.completed && status.hasProvider && status.isPaired
          ? "install"
          : resumeStepFor(status);
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
      this.step = "vault";
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

  private renderStepper() {
    const index = STEPS.indexOf(this.step ?? "welcome");
    return html`
      <ol class="psy-onb__stepper" aria-label=${t("onboarding.progress")}>
        ${STEPS.map((id, i) => {
          const state = i < index ? "done" : i === index ? "active" : "upcoming";
          return html`
            <li class="psy-onb__step psy-onb__step--${state}">
              <span class="psy-onb__pip" aria-hidden="true"></span>
              <span class="psy-onb__step-label">${t(`onboarding.step.${id}`)}</span>
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
      case "vault":
        return html`
          <h1 class="psy-onb__title">${t("onboarding.vaultTitle")}</h1>
          <p class="psy-onb__hint">${t("onboarding.vaultBody")}</p>
          ${this.vaultPath ? html`<code class="psy-onb__path">${this.vaultPath}</code>` : nothing}
          <button class="psy-onb__primary" @click=${() => (this.step = "install")}>
            ${t("onboarding.continue")}
          </button>
        `;
      case "install":
        return html`
          <h1 class="psy-onb__title">${t("onboarding.readyTitle")}</h1>
          <p class="psy-onb__hint">${t("onboarding.readyBody")}</p>
          <button class="psy-onb__primary" @click=${() => this.finish()}>
            ${t("onboarding.enter")}
          </button>
        `;
      default:
        return nothing;
    }
  }
}
