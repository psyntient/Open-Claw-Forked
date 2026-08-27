// Vault status indicator for the top bar.
//
// BRANDING.md section 6 calls for a Vault sync indicator / provider badge whose
// hover popup shows the path and writable status; section 7 specifies the
// `psy-aura` "live dot" (scale 1 -> 1.18, opacity .35 -> .7, 7s ease-in-out)
// for exactly this. Both are implemented here.
//
// Data comes from the Psyntient gateway plugin route, backed by
// daemon/vault.mjs getStatus(): { storageMode, path, writable } for local, or
// { storageMode, cloud } otherwise.
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { t } from "../i18n/index.ts";

type VaultStatus = {
  ok?: boolean;
  storageMode?: string;
  path?: string;
  writable?: boolean;
  cloud?: { provider?: string } | null;
  error?: string;
};

const VAULT_ROUTE = "/__openclaw__/psyntient/vault";

@customElement("psyntient-vault-badge")
export class PsyntientVaultBadge extends LitElement {
  // Light DOM: the badge inherits the app's theme tokens and topbar styles
  // rather than duplicating them behind a shadow root.
  protected override createRenderRoot() {
    return this;
  }

  @state() private status: VaultStatus | null = null;
  @state() private failed = false;

  override connectedCallback() {
    super.connectedCallback();
    void this.load();
  }

  /** Never throws: an unreachable Vault must not break the top bar. */
  private async load() {
    try {
      const res = await fetch(VAULT_ROUTE, { credentials: "same-origin" });
      if (!res.ok) {
        this.failed = true;
        return;
      }
      this.status = (await res.json()) as VaultStatus;
    } catch {
      this.failed = true;
    }
  }

  override render() {
    if (this.failed || !this.status?.ok) {
      return nothing;
    }
    const mode = this.status.storageMode ?? "local";
    const isLocal = mode === "local";
    const label = isLocal
      ? t("vaultBadge.local")
      : (this.status.cloud?.provider ?? t("vaultBadge.cloud"));
    // Writable is the thing that actually matters: a Vault that cannot be
    // written to is broken even though it is "configured".
    const healthy = isLocal ? this.status.writable === true : true;
    const detail = isLocal
      ? `${this.status.path ?? ""}${this.status.writable ? "" : ` — ${t("vaultBadge.readOnly")}`}`
      : label;

    return html`
      <openclaw-tooltip .content=${detail}>
        <span
          class="psy-vault-badge ${healthy ? "" : "psy-vault-badge--warn"}"
          role="status"
          aria-label=${`${t("vaultBadge.title")}: ${detail}`}
        >
          <span class="psy-vault-badge__dot psy-aura" aria-hidden="true"></span>
          <span class="psy-vault-badge__label">${label}</span>
        </span>
      </openclaw-tooltip>
    `;
  }
}
